# Automador ServiceNow

Este projeto automatiza o encerramento de incidentes no ServiceNow.

## Como rodar localmente

Se você baixou o projeto e está tentando rodar no seu computador, siga estes passos:

### 1. Instalar dependências
Abra o terminal na pasta do projeto e rode:
```bash
npm install
```

### 2. Instalar o Playwright (Navegadores)
O Playwright precisa baixar os navegadores para funcionar:
```bash
npx playwright install chromium
```

### 3. Rodar o projeto
Existem duas formas de rodar:

#### Modo Desenvolvimento (Recomendado para uso local)
Este modo não exige que você compile o frontend manualmente. Ele usa o Vite para servir os arquivos em tempo real.
```bash
npm run dev
```
O servidor estará disponível em `http://localhost:3000`.

#### Modo Produção
Se você quiser rodar como se estivesse em um servidor real, precisa compilar primeiro:
```bash
npm run build
npm start
```

## Erro "ENOENT: no such file or directory, stat ... dist\index.html"
Este erro acontece porque a pasta `dist` (onde fica o site compilado) não existe. 
Para resolver:
1. Use `npm run dev` em vez de `npm start`.
2. Ou rode `npm run build` antes de rodar `npm start`.

## Configurações
As credenciais e URLs estão configuradas no arquivo `server.ts`. Certifique-se de que seu usuário tem as permissões necessárias no ServiceNow.
