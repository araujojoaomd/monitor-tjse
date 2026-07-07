// ============================================================
// Monitoramento de Processos TJSE — Apps Script (backend)
// Vinculado à planilha (Extensões → Apps Script).
// Abas esperadas (pelo NOME): "Processos" e "Movimentacoes".
// ============================================================

// MESMO Client ID usado no index.html (OAuth Web App).
// Abaixo está o do Painel SETRI (reaproveitado). Troque se criar um cliente novo.
const CLIENT_ID = '864961214405-bipsb4fk0sr0sgi8m9ei81u87rhjshc4.apps.googleusercontent.com';

const ABA_PROCESSOS = 'Processos';
const ABA_MOVS = 'Movimentacoes';

// Colunas da aba Processos (1-based)
const COL = {
  NUMERO: 1, UNICO: 2, VARA: 3, REQUERENTE: 4, REQUERIDO: 5,
  SITUACAO: 6, FASE: 7, DATA_ULT_MOV: 8, DESC_ULT_MOV: 9,
  STATUS_PERITO: 10, DATA_ACAO_PERITO: 11, PENDENCIA: 12, ATUALIZACAO: 13
};

function doGet(e)  { return processar(e); }
function doPost(e) { return processar(e); }

function processar(e) {
  try {
    var dados, idToken;
    if (e.postData && e.postData.contents) {
      dados = JSON.parse(e.postData.contents);
      idToken = dados.idToken;
    } else {
      dados = e.parameter || {};
      idToken = dados.idToken;
    }
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
    if (acao === 'novo_processo') {
      return resposta(novoProcesso(abaProc, dados));
    }
    if (acao === 'editar_processo') {
      return resposta(editarProcesso(abaProc, dados));
    }
    if (acao === 'nova_movimentacao') {
      return resposta(novaMovimentacao(abaProc, abaMov, dados));
    }
    if (acao === 'upsert_movimentacoes') {
      return resposta(upsertMovimentacoes(abaProc, abaMov, dados.movimentacoes || []));
    }
    return resposta({ok:false, erro:'acao_invalida'});
  } catch (err) {
    return resposta({ok:false, erro: String(err)});
  }
}

// ---------- Ações ----------

function novoProcesso(abaProc, d) {
  if (!d.numero) return {ok:false, erro:'numero_vazio'};
  // evita duplicar
  var ultima = abaProc.getLastRow();
  if (ultima >= 2) {
    var nums = abaProc.getRange(2, COL.NUMERO, ultima-1, 1).getValues();
    for (var i=0;i<nums.length;i++) if (String(nums[i][0]) === String(d.numero)) return {ok:false, erro:'processo_duplicado'};
  }
  abaProc.appendRow([
    d.numero, d.numeroUnico||'', d.vara||'', d.requerente||'', d.requerido||'',
    d.situacao||'Em andamento', d.fase||'', '', '',
    d.statusPerito||'', '', d.pendencia||'', d.dataAtualizacao||hojeBR()
  ]);
  return {ok:true};
}

function editarProcesso(abaProc, d) {
  var row = acharLinhaProcesso(abaProc, d.numero);
  if (row === -1) return {ok:false, erro:'processo_nao_encontrado'};
  if (d.situacao !== undefined)       abaProc.getRange(row, COL.SITUACAO).setValue(d.situacao);
  if (d.fase !== undefined)           abaProc.getRange(row, COL.FASE).setValue(d.fase);
  if (d.statusPerito !== undefined)   abaProc.getRange(row, COL.STATUS_PERITO).setValue(d.statusPerito);
  if (d.dataAcaoPerito !== undefined) abaProc.getRange(row, COL.DATA_ACAO_PERITO).setValue(d.dataAcaoPerito);
  if (d.pendencia !== undefined)      abaProc.getRange(row, COL.PENDENCIA).setValue(d.pendencia);
  abaProc.getRange(row, COL.ATUALIZACAO).setValue(hojeBR());
  return {ok:true};
}

function novaMovimentacao(abaProc, abaMov, d) {
  if (!d.numero || !d.data || !d.descricao) return {ok:false, erro:'campos_obrigatorios'};
  var idUnico = montarIdUnico(d.numero, d.data, d.tipo||'');
  if (idUnicoExiste(abaMov, idUnico)) return {ok:true, duplicado:true};
  abaMov.appendRow([d.numero, d.data, d.tipo||'', d.descricao, normalizaSimNao(d.envolvePerito), idUnico]);
  atualizarSnapshot(abaProc, abaMov, d.numero);
  return {ok:true};
}

// Recebe um array de movimentações e insere só as novas (dedup por ID_Unico).
// Usado pela sincronização automática (ex: Claude no navegador).
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

// Atualiza Data_Ultima_Mov / Descricao_Ultima_Mov do processo com a movimentação mais recente.
function atualizarSnapshot(abaProc, abaMov, numero) {
  var row = acharLinhaProcesso(abaProc, numero);
  if (row === -1) return;
  var movs = lerAba(abaMov).filter(function(m){ return String(m.Numero_Processo) === String(numero); });
  if (!movs.length) return;
  movs.sort(function(a,b){ return dataOrd(b.Data_Movimento) - dataOrd(a.Data_Movimento); });
  var ultima = movs[0];
  abaProc.getRange(row, COL.DATA_ULT_MOV).setValue(ultima.Data_Movimento || '');
  abaProc.getRange(row, COL.DESC_ULT_MOV).setValue(ultima.Descricao || '');
  abaProc.getRange(row, COL.ATUALIZACAO).setValue(hojeBR());
}

function acharLinhaProcesso(abaProc, numero) {
  var ultima = abaProc.getLastRow();
  if (ultima < 2) return -1;
  var nums = abaProc.getRange(2, COL.NUMERO, ultima-1, 1).getValues();
  for (var i=0;i<nums.length;i++) if (String(nums[i][0]) === String(numero)) return i + 2;
  return -1;
}

function montarIdUnico(numero, data, tipo) {
  return String(numero) + '|' + String(data) + '|' + String(tipo);
}

function idUnicoExiste(abaMov, idUnico) {
  return !!idsUnicosExistentes(abaMov)[idUnico];
}

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

function hojeBR() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
}

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
      obj[h] = (v instanceof Date)
        ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy')
        : (v == null ? '' : String(v));
    });
    return obj;
  });
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
