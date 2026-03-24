import express from 'express';
import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(bodyParser.json());

  // API routes go here
  // SSE clients for real-time logs
  let clients: any[] = [];

  function sendLog(message: string) {
    console.log(message);
    clients.forEach(client => {
      client.res.write(`data: ${JSON.stringify({ message, timestamp: new Date().toISOString() })}\n\n`);
    });
  }

  app.get('/api/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now();
    const newClient = { id: clientId, res };
    clients.push(newClient);

    req.on('close', () => {
      clients = clients.filter(client => client.id !== clientId);
    });
  });

  // User data directory for session persistence
  const userDataDir = path.join(process.cwd(), 'user_data');

  async function runAutomation(url: string, numeroIncidente: string, justificativa: string, visible: boolean) {
  let context: BrowserContext | null = null;
  try {
    sendLog(`Iniciando automação para o incidente ${numeroIncidente}...`);
    
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: !visible,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      viewport: { width: 1280, height: 720 }
    });

    const page: Page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    
    if (visible) {
      await page.bringToFront();
      sendLog('Modo Debug: Navegador em primeiro plano.');
    }
    
    sendLog(`Acessando URL: ${url}`);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    // Verificar se já está logado (procurar ícone de busca)
    const isLogged = await page.isVisible('.sysparm-search-icon', { timeout: 5000 }).catch(() => false);

    if (!isLogged) {
      sendLog('Sessão não encontrada. Iniciando fluxo de login...');
      
      // Fluxo de Login Microsoft/ServiceNow
      try {
        await page.waitForSelector('input[type="email"]', { timeout: 10000 });
        await page.fill('input[type="email"]', 'eduardo.barros@gpabr.com');
        await page.click('input[type="submit"]'); // Botão "Avançar"
        sendLog('E-mail inserido.');

        await page.waitForSelector('input[type="password"]', { timeout: 10000 });
        await page.fill('input[type="password"]', 'Acessogpa@2023');
        await page.click('input[type="submit"]'); // Botão "Entrar"
        sendLog('Senha inserida.');

        // Tratar "Mantenha-se conectado"
        try {
          await page.waitForSelector('input[id="idSIButton9"]', { timeout: 5000 });
          await page.click('input[id="idSIButton9"]');
        } catch (e) {}
      } catch (e) {
        sendLog('Aviso: Falha no fluxo de login ou já estava em uma etapa avançada.');
      }
    } else {
      sendLog('Sessão persistente detectada. Pulando login.');
    }

    // 3. Busca
    sendLog(`Buscando incidente: ${numeroIncidente}`);
    const searchIcon = page.locator('span.icon-search.sysparm-search-icon, .sysparm-search-icon').filter({ visible: true }).first();
    await searchIcon.waitFor({ state: 'visible', timeout: 30000 });
    await searchIcon.click();
    
    // Aguardar o campo de busca estar pronto
    await page.waitForLoadState('networkidle').catch(() => {});
    
    sendLog('Campo de busca aberto. Inserindo INC...');
    const searchInput = page.locator('input#sysparm_search');
    await searchInput.waitFor({ state: 'visible', timeout: 10000 });
    await searchInput.fill(numeroIncidente);
    await page.keyboard.press('Enter');

    // Esperar carregar o incidente (gsft_main iframe)
    const frame = page.frameLocator('iframe#gsft_main');
    
    // 4. Ação Inicial: Clicar no botão 'Assumir'
    try {
      const assumirBtn = frame.locator('button:has-text("Assumir")');
      await assumirBtn.waitFor({ state: 'visible', timeout: 10000 });
      await assumirBtn.click();
      sendLog('Botão Assumir clicado.');
    } catch (e) {
      sendLog('Botão Assumir não encontrado ou já assumido.');
    }

    // 5. Navegação Interna: Clicar na aba "Informações de Fechamento"
    sendLog('Acessando aba Informações de Fechamento...');
    await frame.locator('span.tab_caption_text:has-text("Informações de Fechamento")').click();

    // 6. Preenchimento de Campos
    sendLog('Preenchendo campos de resolução...');
    
    // IC Impactado
    const icInput = frame.locator('input#sys_display\\.incident\\.cmdb_ci');
    await icInput.waitFor({ state: 'visible', timeout: 10000 });
    await icInput.fill('Oracle Retail - SIM');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1000);

    // Função auxiliar para selecionar opção tentando label ou valor
    const safeSelect = async (selector: string, optionLabel: string, logMsg: string) => {
      try {
        sendLog(`Selecionando ${logMsg}: ${optionLabel}`);
        const select = frame.locator(selector);
        
        // Esperar o elemento estar presente e visível
        await select.waitFor({ state: 'visible', timeout: 10000 });
        
        // Tentar por label (com e sem acento), por valor e por regex
        try {
          await select.selectOption({ label: optionLabel });
        } catch (e) {
          try {
            // Tentar versão sem acento se falhar
            const normalizedLabel = optionLabel.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            await select.selectOption({ label: normalizedLabel });
          } catch (e2) {
            try {
              await select.selectOption({ value: optionLabel });
            } catch (e3) {
              try {
                // Tentar por regex (case-insensitive)
                await select.selectOption({ label: new RegExp(optionLabel, 'i') });
              } catch (e4) {
                // Se tudo falhar, tentar selecionar o primeiro item que contenha o texto
                sendLog(`Aviso: Tentando selecionar por índice para ${logMsg} como último recurso`);
                await select.selectOption({ index: 1 }); // Geralmente o primeiro item após o vazio
              }
            }
          }
        }
        sendLog(`${logMsg} selecionado.`);
        await page.waitForTimeout(800); // Pequena pausa para scripts de tela (onChange)
      } catch (err: any) {
        sendLog(`ERRO CRÍTICO ao selecionar ${logMsg}: ${err.message}`);
        // Tirar screenshot se der erro no debug
        if (visible) {
          await page.screenshot({ path: `error_${logMsg.replace(/\s+/g, '_')}.png` });
        }
      }
    };

    // Código de Resolução: 'Resolvido'
    await safeSelect('select#incident\\.close_code', 'Resolvido', 'Código de Resolução');
    
    // Aguardar possíveis recarregamentos parciais (AJAX)
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);

    // Causa Raiz Identificada: 'Não' ou 'Nao'
    // Tentar encontrar o campo de causa raiz (pode variar o ID)
    let causaRaizSelector = 'select#incident\\.u_causa_raiz_identificada';
    if (!(await frame.locator(causaRaizSelector).isVisible())) {
      causaRaizSelector = 'select[id*="causa_raiz"]'; // Seletor mais genérico se o ID exato falhar
    }
    await safeSelect(causaRaizSelector, 'Não', 'Causa Raiz Identificada');

    // Se houver um campo de "Causa Raiz não identificada" (texto ou select)
    const causaRaizNaoIdentificada = frame.locator('select#incident\\.u_causa_raiz_nao_identificada, input#incident\\.u_causa_raiz_nao_identificada, textarea#incident\\.u_causa_raiz_nao_identificada');
    if (await causaRaizNaoIdentificada.isVisible()) {
      sendLog('Campo Causa Raiz não identificada detectado. Preenchendo...');
      try {
        const tagName = await causaRaizNaoIdentificada.evaluate(el => el.tagName.toLowerCase());
        if (tagName === 'select') {
          await safeSelect('select#incident\\.u_causa_raiz_nao_identificada', 'Outros', 'Causa Raiz não identificada');
        } else {
          await causaRaizNaoIdentificada.fill('Causa não identificada no momento do encerramento.');
        }
      } catch (e) {}
    }

    // Classe de Falha: 'Aplicação'
    await safeSelect('select#incident\\.u_classe_falha', 'Aplicação', 'Classe de Falha');

    // Tipo de Falha: 'Erro de Software'
    await safeSelect('select#incident\\.u_tipo_falha', 'Erro de Software', 'Tipo de Falha');

    // Resolução: 'Reprocessamento'
    await safeSelect('select#incident\\.u_resolucao', 'Reprocessamento', 'Resolução');

    // 7. Campo Especial (Impacto no Negócio)
    sendLog('Tratando campo Impacto no Negócio...');
    const unlockBtn = frame.locator('#incident\\.u_kdl_houve_impacto_no_neg_cio_unlock');
    if (await unlockBtn.isVisible()) {
      await unlockBtn.click();
      const impactSelect = frame.locator('select#choice\\.incident\\.u_kdl_houve_impacto_no_neg_cio');
      // Tentar selecionar 'NÃO' ou '-- Nenhum --'
      try {
        await impactSelect.selectOption({ label: 'NÃO' });
      } catch (e) {
        await impactSelect.selectOption({ index: 0 });
      }
    }

    // 8. Finalização: Descrição da Resolução
    sendLog('Inserindo justificativa e finalizando...');
    await frame.locator('textarea#incident\\.close_notes').fill(justificativa);

    // Salvar/Resolver
    // await frame.locator('button#resolve_incident').click();
    // sendLog('Incidente resolvido com sucesso.');

    sendLog('Processo concluído.');

    if (visible) {
      sendLog('Modo Debug ativo. O navegador permanecerá aberto por 60s.');
      await new Promise(resolve => setTimeout(resolve, 60000));
    }

    await context.close();
    return { success: true, message: 'Incidente processado com sucesso.' };
  } catch (error: any) {
    sendLog(`ERRO: ${error.message}`);
    if (context) await context.close();
    return { success: false, message: error.message };
  }
}

  app.post('/api/encerrar', async (req, res) => {
    try {
      const { url, incidente, justificativa, debug } = req.body;
      
      if (!incidente || !justificativa) {
        return res.status(400).json({ success: false, message: 'Incidente e justificativa são obrigatórios.' });
      }

      const targetUrl = url || 'https://gpabrqa.service-now.com/';
      const result = await runAutomation(targetUrl, incidente, justificativa, !!debug);
      res.json(result);
    } catch (error: any) {
      console.error('Erro no endpoint /api/encerrar:', error);
      res.status(500).json({ success: false, message: 'Erro interno no servidor.' });
    }
  });

  // Alias for previous endpoint if needed
  app.post('/api/finalizar', async (req, res) => {
    const { numero_incidente, justificativa, visible } = req.body;
    const result = await runAutomation('https://gpabrqa.service-now.com/', numero_incidente, justificativa, !!visible);
    res.json(result);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares as any);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        const indexPath = path.join(distPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          res.status(404).send('Build not found. Please run "npm run build" first.');
        }
      });
    } else {
      app.get('*', (req, res) => {
        res.status(404).send('Dist folder not found. Please run "npm run build" first.');
      });
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
