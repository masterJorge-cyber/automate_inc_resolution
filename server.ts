import express from 'express';
import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import bodyParser from 'body-parser';
// Removed Vite imports

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
  let currentContext: BrowserContext | null = null;

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
    currentContext = context;

    const page: Page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    
    if (visible) {
      await page.bringToFront();
      sendLog('Modo Debug: Navegador iniciado em primeiro plano.');
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
    sendLog('Aguardando carregamento do incidente...');
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(2000);
    
    try {
      const assumirSelectors = [
        'button#assign_to_me',
        'button[id="assign_to_me"]',
        'button:has-text("Assumir")',
        'button:has-text("Assign to me")',
        'button[name="assign_to_me"]',
        '#sysverb_assign_to_me'
      ];
      
      let clicked = false;
      for (const selector of assumirSelectors) {
        const btn = frame.locator(selector).first();
        if (await btn.isVisible()) {
          sendLog(`Clicando em Assumir (${selector})...`);
          await btn.click();
          clicked = true;
          break;
        }
      }
      
      if (clicked) {
        sendLog('Botão Assumir clicado. Aguardando atualização...');
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(3000);
      } else {
        sendLog('Botão Assumir não encontrado ou já assumido.');
      }
    } catch (e) {
      sendLog('Erro ao tentar clicar em Assumir.');
    }

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
              // Se tudo falhar, tentar selecionar o primeiro item que contenha o texto
              sendLog(`Aviso: Tentando selecionar por índice para ${logMsg} como último recurso`);
              await select.selectOption({ index: 1 }); // Geralmente o primeiro item após o vazio
            }
          }
        }
        sendLog(`${logMsg} selecionado.`);
        await page.waitForTimeout(800); // Pequena pausa para scripts de tela (onChange)
      } catch (err: any) {
        sendLog(`Aviso ao selecionar ${logMsg}: ${err.message}`);
      }
    };

    // Função para preencher campos que podem ser Select ou Referência (Input com lupa)
    const fillSmartField = async (baseId: string, value: string, logMsg: string, isLookup: boolean = false) => {
      try {
        sendLog(`Tratando campo ${logMsg}...`);
        const selectSelector = `select#incident\\.${baseId.replace(/\./g, '\\.')}`;
        const inputSelector = `input#sys_display\\.incident\\.${baseId.replace(/\./g, '\\.')}`;
        
        const selectEl = frame.locator(selectSelector);
        const inputEl = frame.locator(inputSelector);

        if (await selectEl.isVisible()) {
          await safeSelect(selectSelector, value, logMsg);
        } else if (await inputEl.isVisible()) {
          sendLog(`Preenchendo referência ${logMsg}: ${value}`);
          await inputEl.clear();
          await inputEl.fill(value);
          await page.waitForTimeout(500);
          
          if (isLookup) {
            // Fluxo específico para Lookup: Digitar e Enter/Tab
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1000);
            // Tentar Tab se Enter não bastar
            await page.keyboard.press('Tab');
          } else {
            await page.keyboard.press('Enter');
          }
          
          await page.waitForTimeout(1000);
          sendLog(`${logMsg} preenchido.`);
        } else {
          // Tentar busca genérica por ID
          const generic = frame.locator(`[id*="${baseId}"]`).first();
          if (await generic.isVisible()) {
            const tagName = await generic.evaluate(el => el.tagName.toLowerCase());
            if (tagName === 'select') {
              await safeSelect(`[id*="${baseId}"]`, value, logMsg);
            } else {
              await generic.fill(value);
              await page.keyboard.press(isLookup ? 'Enter' : 'Tab');
              await page.waitForTimeout(1000);
            }
          } else {
            sendLog(`Aviso: Campo ${logMsg} não visível.`);
          }
        }
      } catch (e: any) {
        sendLog(`Erro no campo ${logMsg}: ${e.message}`);
      }
    };

    // 5. Navegação Interna: Clicar na aba "Informações de Fechamento"
    try {
      sendLog('Acessando aba Informações de Fechamento...');
      const tabFechamento = frame.locator('span.tab_caption_text:has-text("Informações de Fechamento")');
      await tabFechamento.waitFor({ state: 'visible', timeout: 5000 });
      await tabFechamento.click();
      await page.waitForTimeout(1000);
    } catch (e) {
      sendLog('Aviso: Não foi possível clicar na aba de fechamento.');
    }

    // 6. Preenchimento de Campos (Ordem solicitada)
    sendLog('Iniciando preenchimento dos campos...');

    // IC Impactado (Oracle Retail - SIM)
    try {
      const icInput = frame.locator('input#sys_display\\.incident\\.cmdb_ci');
      if (await icInput.isVisible()) {
        sendLog('Preenchendo IC Impactado: Oracle Retail - SIM');
        await icInput.clear();
        await icInput.fill('Oracle Retail - SIM');
        await page.waitForTimeout(1000);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
      }
    } catch (e) {
      sendLog('Aviso: Campo IC Impactado não encontrado.');
    }

    // Código de Resolução: 'Resolvido'
    await safeSelect('select#incident\\.close_code', 'Resolvido', 'Código de Resolução');
    await page.waitForTimeout(1000);

    // Causa Raiz Identificada: 'Não'
    let causaRaizSelector = 'select#incident\\.u_causa_raiz_identificada';
    if (!(await frame.locator(causaRaizSelector).isVisible())) {
      causaRaizSelector = 'select[id*="causa_raiz"]';
    }
    await safeSelect(causaRaizSelector, 'Não', 'Causa Raiz Identificada');

    // Classe de Falha: 'Aplicação'
    await fillSmartField('u_classe_de_falha', 'Aplicação', 'Classe de Falha', true);

    // Tipo de Falha: 'Falha na integração'
    await fillSmartField('u_tipo_de_falha', 'Falha na integração', 'Tipo de Falha', true);

    // Resolução: 'Reprocessamento'
    await fillSmartField('u_resolucao_da_falha', 'Reprocessamento', 'Resolução', true);

    // Houve impacto no negócio?
    try {
      sendLog('Tratando campo Impacto no Negócio...');
      const unlockBtn = frame.locator('#incident\\.u_kdl_houve_impacto_no_neg_cio_unlock');
      if (await unlockBtn.isVisible()) {
        await unlockBtn.click();
        await page.waitForTimeout(500);
        const impactSelect = frame.locator('select#choice\\.incident\\.u_kdl_houve_impacto_no_neg_cio');
        try {
          await impactSelect.selectOption({ label: 'NÃO' });
        } catch (e) {
          await impactSelect.selectOption({ index: 0 });
        }
      } else {
        const impactSelect = frame.locator('select#choice\\.incident\\.u_kdl_houve_impacto_no_neg_cio, select[id*="impacto_no_neg_cio"]');
        if (await impactSelect.isVisible()) {
          await impactSelect.selectOption({ label: 'NÃO' });
        }
      }
    } catch (e) {
      sendLog('Aviso: Falha ao tratar Impacto no Negócio.');
    }

    // Descrição da Resolução
    sendLog('Inserindo justificativa...');
    try {
      const closeNotes = frame.locator('textarea#incident\\.close_notes');
      await closeNotes.fill(justificativa);
    } catch (e) {
      sendLog('Erro ao preencher Descrição da Resolução.');
    }

    // Salvar/Resolver
    // await frame.locator('button#resolve_incident').click();
    // sendLog('Incidente resolvido com sucesso.');

    sendLog('Processo concluído.');

    if (visible) {
      sendLog('Modo Debug ativo. O navegador permanecerá aberto por 60s.');
      await new Promise(resolve => setTimeout(resolve, 60000));
    }

    if (context) await context.close();
    currentContext = null;
    return { success: true, message: 'Incidente processado com sucesso.' };
  } catch (error: any) {
    sendLog(`ERRO: ${error.message}`);
    if (context) await context.close();
    currentContext = null;
    return { success: false, message: error.message };
  }
}

  app.post('/api/encerrar', async (req, res) => {
    try {
      if (currentContext) {
        return res.status(400).json({ success: false, message: 'Uma automação já está em andamento.' });
      }

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

  app.post('/api/parar', async (req, res) => {
    try {
      if (currentContext) {
        sendLog('Comando de parada recebido. Fechando navegador...');
        await currentContext.close();
        currentContext = null;
        res.json({ success: true, message: 'Automação interrompida pelo usuário.' });
      } else {
        res.json({ success: false, message: 'Nenhuma automação em execução.' });
      }
    } catch (error: any) {
      console.error('Erro ao parar automação:', error);
      res.status(500).json({ success: false, message: 'Erro ao interromper a automação.' });
    }
  });

  // Alias for previous endpoint if needed
  app.post('/api/finalizar', async (req, res) => {
    const { numero_incidente, justificativa, visible } = req.body;
    const result = await runAutomation('https://gpabrqa.service-now.com/', numero_incidente, justificativa, !!visible);
    res.json(result);
  });

  // Serve static files from the public folder
  app.use(express.static(path.join(__dirname, 'public')));

  // Fallback to index.html for SPA behavior
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
