# Setup — Monitoramento de Processos TJSE

Painel próprio no molde do Painel SETRI: página única (`index.html`) no GitHub Pages,
login Google, lendo/gravando numa planilha do Google Sheets via Apps Script.

Arquitetura (idêntica ao SETRI):

```
[ navegador: login Google ]
        ↓ POST com ID token + ação
[ index.html no GitHub Pages ]
        ↓
[ Apps Script (Web App) ]  → verifica token e acesso
        ↓
[ Google Sheets: abas Processos + Movimentacoes ]
```

Os componentes do Google (planilha, Apps Script, OAuth) **só você** consegue criar —
o Claude não tem como. Siga os passos abaixo na ordem. Ao final, o painel está no ar.

---

## 1. Criar a planilha (o "banco")

1. Google Drive → **Novo → Planilha Google**. Nomeie, ex: `Monitoramento Processos TJSE`.
2. Crie **duas abas** com estes nomes exatos (respeite maiúsculas/acentos):
   - `Processos`
   - `Movimentacoes` (sem acento no "ç" — é só a aba; o painel usa esse nome exato)
3. Na aba **Processos**, cole na **linha 1** (cabeçalho), uma coluna por célula A1..H1:

```
Numero_Processo	Numero_Unico	Vara	Requerente	Requerido	Situacao	Data_Julgamento	Data_Consulta
```

Só identidade + situação (capturadas do site, não inferidas). `Vara` = campo "Competência"
do e-SAJ. `Situacao` = campo "Situação" (JULGADO, EM ANDAMENTO, ARQUIVADO…). `Data_Julgamento`
só quando JULGADO. `Data_Consulta` = data em que o processo foi consultado por último (o
Claude preenche com a data do dia; o painel mostra a mais recente como "Última consulta").
Todo o status do perito/alvará o painel mostra a partir das MOVIMENTAÇÕES.

4. Na aba **Movimentacoes**, cole na **linha 1**, A1..F1:

```
Numero_Processo	Data_Movimento	Tipo_Movimento	Descricao	Envolve_Perito	ID_Unico
```

> Dica: cole com **Ctrl+V** numa célula A1 — como está separado por TAB, o Sheets
> distribui automaticamente nas colunas.

**Formato das datas:** o painel trabalha com `dd/mm/aaaa` (texto). Para não ter dor de
cabeça com o Sheets convertendo datas, deixe as colunas de data como **texto simples**
(Formatar → Número → Texto simples) nas duas abas.

**Regras dos valores:**
- `Numero_Processo`: número resumido (ex: `202552000005`) — é a chave que liga com a aba
  Movimentacoes. `Numero_Unico`: o CNJ (ex: `0004795-37.2024.8.25.0034`).
- `Situacao`: o texto que o site mostrar (JULGADO, EM ANDAMENTO, ARQUIVADO, SUSPENSO…).
- `Envolve_Perito` (aba Movimentacoes): `SIM` ou `NÃO`.
- `ID_Unico` (aba Movimentacoes): `Numero_Processo|Data_Movimento|Tipo_Movimento` — chave
  anti-duplicação.

**O painel é um espelho das movimentações.** Ele lista os processos (nome/vara/situação da
aba Processos) e, ao clicar, mostra a linha do tempo das movimentações, destacando as do
perito (`Envolve_Perito`=SIM) e as de alvará (texto com "alvará"). Não infere etapas,
pendências nem status de alvará.

---

## 2. Colar o Apps Script

1. Na planilha: **Extensões → Apps Script**.
2. Apague o conteúdo do `Code.gs` e cole **todo** o arquivo `apps-script.gs` deste projeto.
3. Salve (💾). Ainda falta o Client ID (passo 3) e o deploy (passo 4).

---

## 3. OAuth Client ID (identidade Google)

Você pode **reaproveitar o Client ID do Painel SETRI** (mais rápido) ou criar um novo.

**Opção A — reaproveitar o do SETRI (recomendado p/ agilizar):**
1. Google Cloud Console → projeto `Painel SETRI` → **APIs e serviços → Credenciais**.
2. Abra o OAuth Client existente (`864961214405-...apps.googleusercontent.com`).
3. Em **Origens JavaScript autorizadas**, clique **+ Adicionar URI** e coloque a URL do
   novo GitHub Pages (ex: `https://SEU_USUARIO.github.io`). Salve.
4. Use esse mesmo Client ID nos dois lugares (passo 5).

**Opção B — criar um novo:** Criar credencial → **ID do cliente OAuth** → tipo
**Aplicativo da Web** → adicione a origem `https://SEU_USUARIO.github.io` → copie o Client ID.

---

## 4. Publicar o Apps Script como Web App

1. No editor do Apps Script: **Implantar → Nova implantação**.
2. Tipo: **App da Web**.
3. **Executar como:** *Eu* (necessário pra ler a lista de acesso da planilha).
4. **Quem tem acesso:** *Qualquer pessoa* (a segurança real é o token, não a porta).
5. Implantar → autorize as permissões quando pedir → **copie a URL** que termina em `/exec`.

> Ao alterar o `apps-script.gs` depois: **Implantar → Gerenciar implantações → ✏️ →
> Versão: Nova versão → Implantar.** A URL continua a mesma.

---

## 5. Preencher o `index.html` e o `apps-script.gs`

No `index.html`, topo do `<script>`:
```js
const CLIENT_ID = 'COLE_AQUI_O_CLIENT_ID.apps.googleusercontent.com';
const API_URL   = 'COLE_AQUI_A_URL_DO_APPS_SCRIPT';   // a URL /exec do passo 4
```
No `apps-script.gs`, topo:
```js
const CLIENT_ID = 'COLE_AQUI_O_CLIENT_ID.apps.googleusercontent.com';  // o MESMO acima
```
(Depois de editar o `.gs`, republique — passo 4, nota.)

Me avisa o Client ID e a URL que eu preencho os arquivos pra você, se preferir.

---

## 6. GitHub Pages

1. Crie um repositório novo (ex: `monitor-tjse`) — pode ser **público** (necessário pro
   Pages grátis) ou privado se tiver Pages no plano.
2. Suba os arquivos (`index.html` basta; `apps-script.gs`, `SETUP.md` e `CLAUDE.md`
   ficam de referência):
   ```
   git init && git add . && git commit -m "painel monitoramento TJSE"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/monitor-tjse.git
   git push -u origin main
   ```
3. No GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / root**. Salve.
4. Em ~1 min sai a URL `https://SEU_USUARIO.github.io/monitor-tjse/`.
5. **Confira que essa URL bate com a origem autorizada no OAuth (passo 3).** Se não bater,
   o botão de login não aparece.

---

## 7. Dar acesso

- Compartilhe a **planilha** com cada conta Google que pode usar o painel (qualquer
  permissão: Viewer já entra). Quem não estiver no compartilhamento vê "sem acesso".
- Remover do compartilhamento = revoga o acesso ao painel na hora.

---

## Como o Claude no navegador alimenta os dados

Fluxo de sincronização (você aciona quando quiser, ex: toda segunda):

1. Você pede ao Claude (Chrome) pra checar a lista de processos no TJSE.
2. Ele compara com o que já está na planilha e monta a lista de movimentações novas.
3. Ele grava as novidades. Duas formas:
   - **Direto na planilha** (editando a aba `Movimentacoes`), respeitando o `ID_Unico`
     pra não duplicar; ou
   - **Via Apps Script** chamando a ação `upsert_movimentacoes` com um array
     `[{numero, data, tipo, descricao, envolvePerito}]` — o backend deduplica por
     `ID_Unico` e já atualiza o snapshot (`Data_Ultima_Mov`/`Descricao_Ultima_Mov`) de
     cada processo. Retorna quantos inseriu e quantos ignorou.
4. O painel é a camada de leitura: você acompanha situação, status do perito, pendências
   e a linha do tempo (com filtro "só perito") por processo.

Ações disponíveis no Apps Script: `ler`, `novo_processo`, `editar_processo`,
`nova_movimentacao`, `upsert_movimentacoes`.

---

## Checklist rápido

- [ ] Planilha criada com abas `Processos` e `Movimentacoes` + cabeçalhos exatos
- [ ] `apps-script.gs` colado e Client ID preenchido no `.gs`
- [ ] OAuth Client ID com a origem do GitHub Pages autorizada
- [ ] Apps Script publicado (Executar como Eu / Qualquer pessoa) → URL `/exec` copiada
- [ ] `CLIENT_ID` e `API_URL` preenchidos no `index.html`
- [ ] Repo no GitHub + Pages ligado em `main`/root
- [ ] Planilha compartilhada com as contas de acesso
