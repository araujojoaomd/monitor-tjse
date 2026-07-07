// ============================================================
// Monitoramento de Processos TJSE — Apps Script (backend)
// Vinculado à planilha (Extensões → Apps Script).
// Abas esperadas (pelo NOME): "Processos" e "Movimentacoes".
// O painel é SOMENTE LEITURA; a alimentação dos dados é feita
// pela consulta no Claude (navegador), editando a planilha ou
// chamando as ações upsert_processo / upsert_movimentacoes.
// ============================================================

// MESMO Client ID usado no index.html (OAuth Web App).
const CLIENT_ID = '864961214405-bipsb4fk0sr0sgi8m9ei81u87rhjshc4.apps.googleusercontent.com';

const ABA_PROCESSOS = 'Processos';
const ABA_MOVS = 'Movimentacoes';

function doGet(e)  { return processar(e); }
function doPost(e) { return processar(e); }

function processar(e) {
  try {
    var dados, idToken;
    if (e.postData && e.postData.contents) { dados = JSON.parse(e.postData.contents); idToken = dados.idToken; }
    else { dados = e.parameter || {}; idToken = dados.idToken; }
    if (!idToken) return resposta({ok:false, erro:'sem_token'});

    var email = verificarToken(idToken);
    if (!email) return resposta({ok:false, erro:'token_invalido'});

    var planilha = SpreadsheetApp.getActiveSpreadsheet();
    if (!temAcesso(planilha, email)) return resposta({ok:false, erro:'sem_acesso', email: email});

    var abaProc = planilha.getSheetByName(ABA_PROCESSOS);
    var abaMov  = planilha.getSheetByName(ABA_MOVS);
    if (!abaProc || !abaMov) return resposta({ok:false, erro:'abas_nao_encontradas'});

    var acao = dados.acao;
    if (acao === 'ler') {
      return resposta({ok:true, email:email, processos: lerAba(abaProc), movimentacoes: lerAba(abaMov)});
    }
    if (acao === 'upsert_processo') {
      return resposta(upsertProcesso(abaProc, dados));
    }
    if (acao === 'upsert_movimentacoes') {
      return resposta(upsertMovimentacoes(abaProc, abaMov, dados.movimentacoes || []));
    }
    return resposta({ok:false, erro:'acao_invalida'});
  } catch (err) {
    return resposta({ok:false, erro: String(err)});
  }
}

// ---------- Ações de escrita (opcionais, p/ sync automática) ----------

// Cria ou atualiza a linha do processo por Numero_Processo, gravando
// apenas os campos informados em `campos` (mapa cabeçalho→valor).
// Tolerante ao schema: só escreve nas colunas cujo cabeçalho existir.
function upsertProcesso(abaProc, d) {
  var campos = d.campos || {};
  var num = d.numero || campos['Numero_Processo'];
  if (!num) return {ok:false, erro:'numero_vazio'};
  var headers = cabecalhos(abaProc);
  var idx = {}; headers.forEach(function(h,i){ idx[h] = i; });
  if (!('Numero_Processo' in idx)) return {ok:false, erro:'coluna_Numero_Processo_ausente'};

  var row = acharLinhaProcesso(abaProc, num);
  if (row === -1) {
    var arr = headers.map(function(h){
      if (h === 'Numero_Processo') return num;
      return (campos.hasOwnProperty(h) ? campos[h] : '');
    });
    abaProc.appendRow(arr);
  } else {
    Object.keys(campos).forEach(function(h){
      if (h in idx) abaProc.getRange(row, idx[h] + 1).setValue(campos[h]);
    });
  }
  return {ok:true};
}

// Insere só as movimentações novas (dedup por ID_Unico) e atualiza o
// snapshot (Data_Ultima_Mov / Descricao_Ultima_Mov) dos processos afetados.
function upsertMovimentacoes(abaProc, abaMov, lista) {
  if (!lista.length) return {ok:true, inseridos:0, ignorados:0};
  var existentes = idsUnicosExistentes(abaMov);
  var linhas = [], afetados = {}, ignorados = 0;
  lista.forEach(function(m) {
    if (!m.numero || !m.data) { ignorados++; return; }
    var idUnico = m.idUnico || montarIdUnico(m.numero, m.data, m.tipo||'');
    if (existentes[idUnico]) { ignorados++; return; }
    existentes[idUnico] = true;
    linhas.push([m.numero, m.data, m.tipo||'', m.descricao||'', normalizaSimNao(m.envolvePerito), idUnico]);
    afetados[m.numero] = true;
  });
  if (linhas.length) {
    var start = abaMov.getLastRow() + 1;
    abaMov.getRange(start, 1, linhas.length, 6).setValues(linhas);
  }
  Object.keys(afetados).forEach(function(num){ atualizarSnapshot(abaProc, abaMov, num); });
  return {ok:true, inseridos: linhas.length, ignorados: ignorados};
}

// ---------- Auxiliares ----------

function cabecalhos(aba) {
  var lc = aba.getLastColumn();
  if (lc < 1) return [];
  return aba.getRange(1, 1, 1, lc).getValues()[0].map(function(h){ return String(h).trim(); });
}

// Atualiza Data_Ultima_Mov / Descricao_Ultima_Mov (se essas colunas existirem)
// com a movimentação mais recente do processo.
function atualizarSnapshot(abaProc, abaMov, numero) {
  var row = acharLinhaProcesso(abaProc, numero);
  if (row === -1) return;
  var headers = cabecalhos(abaProc);
  var colData = headers.indexOf('Data_Ultima_Mov');
  var colDesc = headers.indexOf('Descricao_Ultima_Mov');
  var colAtu  = headers.indexOf('Data_Ultima_Atualizacao_Painel');
  var movs = lerAba(abaMov).filter(function(m){ return String(m.Numero_Processo) === String(numero); });
  if (!movs.length) return;
  movs.sort(function(a,b){ return dataOrd(b.Data_Movimento) - dataOrd(a.Data_Movimento); });
  var ultima = movs[0];
  if (colData !== -1) abaProc.getRange(row, colData+1).setValue(ultima.Data_Movimento || '');
  if (colDesc !== -1) abaProc.getRange(row, colDesc+1).setValue(ultima.Descricao || '');
  if (colAtu  !== -1) abaProc.getRange(row, colAtu+1).setValue(hojeBR());
}

function acharLinhaProcesso(abaProc, numero) {
  var ultima = abaProc.getLastRow();
  if (ultima < 2) return -1;
  var nums = abaProc.getRange(2, 1, ultima-1, 1).getValues(); // coluna A = Numero_Processo
  for (var i=0;i<nums.length;i++) if (String(nums[i][0]) === String(numero)) return i + 2;
  return -1;
}

function montarIdUnico(numero, data, tipo) { return String(numero) + '|' + String(data) + '|' + String(tipo); }
function idsUnicosExistentes(abaMov) {
  var ultima = abaMov.getLastRow();
  var mapa = {};
  if (ultima < 2) return mapa;
  var vals = abaMov.getRange(2, 6, ultima-1, 1).getValues(); // coluna F = ID_Unico
  for (var i=0;i<vals.length;i++) if (vals[i][0]) mapa[String(vals[i][0])] = true;
  return mapa;
}
function normalizaSimNao(v) {
  var s = String(v||'').trim().toUpperCase();
  return (s === 'SIM' || s === 'S' || s === 'TRUE' || s === 'SÍ') ? 'SIM' : 'NÃO';
}
function dataOrd(s) {
  var p = String(s||'').split('/');
  if (p.length !== 3) return 0;
  return new Date(+p[2], +p[1]-1, +p[0]).getTime() || 0;
}
function hojeBR() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy'); }

function verificarToken(idToken) {
  try {
    var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
    var resp = UrlFetchApp.fetch(url, {muteHttpExceptions:true});
    if (resp.getResponseCode() !== 200) return null;
    var info = JSON.parse(resp.getContentText());
    if (info.aud !== CLIENT_ID) return null;
    if (info.email_verified !== 'true' && info.email_verified !== true) return null;
    return info.email;
  } catch (e) { return null; }
}

function temAcesso(planilha, email) {
  try {
    var owner = planilha.getOwner();
    if (owner && owner.getEmail() === email) return true;
    var editors = planilha.getEditors();
    for (var i=0;i<editors.length;i++) if (editors[i].getEmail() === email) return true;
    var viewers = planilha.getViewers();
    for (var i=0;i<viewers.length;i++) if (viewers[i].getEmail() === email) return true;
    return false;
  } catch (e) { return false; }
}

function lerAba(aba) {
  if (!aba) return [];
  var valores = aba.getDataRange().getValues();
  if (valores.length < 2) return [];
  var headers = valores[0].map(function(h){ return String(h).trim(); });
  return valores.slice(1).filter(function(r){ return r[0]; }).map(function(r){
    var obj = {};
    headers.forEach(function(h, i){
      var v = r[i];
      obj[h] = (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy') : (v == null ? '' : String(v));
    });
    return obj;
  });
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
