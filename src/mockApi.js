// Mock data for demo mode testing

let nextId = 1007;

const MOCK_CONTACTS = [
  { id: 987654321, nome: 'João da Silva', numeroDocumento: '123.456.789-00' },
  { id: 123456789, nome: 'Maria Oliveira', numeroDocumento: '987.654.321-00' },
  { id: 555111222, nome: 'Carlos Souza', numeroDocumento: '456.789.123-00' },
];

const SITUACOES = [
  { id: 1, valor: 'Pendente' },
  { id: 2, valor: 'Cancelada' },
  { id: 3, valor: 'Aguardando' },
  { id: 6, valor: 'Autorizada' },
  { id: 7, valor: 'Emitida' },
  { id: 9, valor: 'Cadastrada' },
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(daysBack = 30) {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysBack));
  return d.toISOString().slice(0, 10);
}

function generateMockNotas(count = 12) {
  const notas = [];
  for (let i = 0; i < count; i++) {
    const contato = randomItem(MOCK_CONTACTS);
    const situacao = randomItem(SITUACOES);
    const qtd = Math.floor(Math.random() * 5000) + 500;
    const vlr = 2 + Math.random() * 0.5;
    const total = Math.round(qtd * vlr * 100) / 100;
    const num = 1000 + i;

    notas.push({
      id: num,
      numero: `${num}`,
      serie: 2,
      dataEmissao: randomDate(),
      situacao,
      contato: { id: contato.id, nome: contato.nome },
      totalProdutos: total,
      valorNota: Math.round(total * 1.025 * 100) / 100,
    });
  }
  return notas.sort((a, b) => b.dataEmissao.localeCompare(a.dataEmissao));
}

let mockNotas = generateMockNotas();

function findNota(id) {
  return mockNotas.find((n) => n.id === Number(id));
}

function delay(ms = 400) {
  return new Promise((r) => setTimeout(r, ms + Math.random() * 300));
}

// ─── Mock API functions ───────────────────────────────────

export async function mockCriarNfe(payload) {
  await delay(600);
  const id = nextId++;
  const qtd = payload.itens?.[0]?.quantidade || 0;
  const vlr = payload.itens?.[0]?.valor || 0;
  const total = Math.round(qtd * vlr * 100) / 100;

  const nota = {
    id,
    numero: `${id}`,
    serie: payload.serie || 2,
    dataEmissao: new Date().toISOString().slice(0, 10),
    situacao: { id: 1, valor: 'Pendente' },
    contato: { id: payload.contato?.id, nome: `Produtor #${payload.contato?.id}` },
    totalProdutos: total,
    valorNota: Math.round(total * 1.025 * 100) / 100,
  };

  mockNotas.unshift(nota);
  return { data: { id } };
}

export async function mockListarNfe({ pagina = 1, limite = 10 } = {}) {
  await delay();
  const start = (pagina - 1) * limite;
  const data = mockNotas.slice(start, start + limite);
  return { data };
}

export async function mockObterNfe(id) {
  await delay();
  const nota = findNota(id);
  if (!nota) throw { status: 404, data: { error: { message: 'Nota não encontrada' } } };

  const isAuthorized = nota.situacao.id >= 6;
  return {
    data: {
      ...nota,
      naturezaOperacao: 'Compra de mercadorias',
      chaveAcesso: isAuthorized
        ? `3525${String(nota.id).padStart(40, '0')}1`
        : null,
      linkPDF: isAuthorized ? `mock://pdf/${nota.id}` : null,
      linkDanfe: isAuthorized ? `mock://danfe/${nota.id}` : null,
      observacoes: 'Operação tributada nos termos do art 296 da parte 1 do Anexo VIII do RICMS.',
    },
  };
}

export async function mockEnviarNfe(id) {
  await delay(800);
  const nota = findNota(id);
  if (!nota) throw { status: 404, data: { error: { message: 'Nota não encontrada' } } };

  nota.situacao = { id: 6, valor: 'Autorizada' };
  return { data: { id: nota.id } };
}

// ─── Mock PDF Generator ──────────────────────────────────

function fmt(v) {
  return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function mockGeneratePDF(detail) {
  const chave = detail.chaveAcesso || '—';
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>DANFE - NFe ${detail.numero || detail.id}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4; margin: 12mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; padding: 12mm; }
    .danfe { border: 2px solid #000; padding: 0; }
    .row { display: flex; border-bottom: 1px solid #000; }
    .row:last-child { border-bottom: none; }
    .cell { padding: 4px 6px; border-right: 1px solid #000; flex: 1; }
    .cell:last-child { border-right: none; }
    .cell-label { font-size: 7px; color: #555; text-transform: uppercase; margin-bottom: 2px; display: block; }
    .cell-value { font-size: 10px; font-weight: bold; }
    .header { text-align: center; padding: 8px; border-bottom: 1px solid #000; }
    .header h1 { font-size: 14px; margin-bottom: 2px; }
    .header p { font-size: 8px; color: #444; }
    .section-title { background: #f0f0f0; padding: 3px 6px; font-weight: bold; font-size: 9px; text-transform: uppercase; border-bottom: 1px solid #000; }
    .chave { font-family: monospace; font-size: 9px; letter-spacing: 1px; word-break: break-all; }
    .table { width: 100%; border-collapse: collapse; font-size: 9px; }
    .table th { background: #f0f0f0; padding: 3px 4px; text-align: left; border: 1px solid #000; font-size: 7px; text-transform: uppercase; }
    .table td { padding: 3px 4px; border: 1px solid #000; }
    .table .right { text-align: right; }
    .obs { padding: 6px; font-size: 8px; line-height: 1.4; }
    .footer { text-align: center; padding: 6px; font-size: 7px; color: #888; border-top: 1px solid #000; }
    .no-print { text-align: center; padding: 16px; }
    .no-print button { padding: 10px 32px; font-size: 14px; background: #3b82f6; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:4px"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg> Imprimir / Salvar PDF</button>
  </div>
  <br>
  <div class="danfe">
    <div class="header">
      <h1>DANFE — Documento Auxiliar da NFe</h1>
      <p>Nota Fiscal Eletrônica de Entrada — Compra de Leite Cru</p>
    </div>

    <div class="section-title">Dados da NFe</div>
    <div class="row">
      <div class="cell" style="flex:0.5"><span class="cell-label">Número</span><span class="cell-value">${detail.numero || detail.id}</span></div>
      <div class="cell" style="flex:0.3"><span class="cell-label">Série</span><span class="cell-value">${detail.serie || 2}</span></div>
      <div class="cell"><span class="cell-label">Data de Emissão</span><span class="cell-value">${detail.dataEmissao ? new Date(detail.dataEmissao).toLocaleDateString('pt-BR') : '—'}</span></div>
      <div class="cell"><span class="cell-label">Natureza da Operação</span><span class="cell-value">${detail.naturezaOperacao || 'Compra de mercadorias'}</span></div>
    </div>
    <div class="row">
      <div class="cell"><span class="cell-label">Chave de Acesso</span><span class="cell-value chave">${chave}</span></div>
    </div>

    <div class="section-title">Emitente / Destinatário</div>
    <div class="row">
      <div class="cell"><span class="cell-label">Produtor (Remetente)</span><span class="cell-value">${detail.contato?.nome || 'Produtor #' + (detail.contato?.id || '—')}</span></div>
      <div class="cell" style="flex:0.5"><span class="cell-label">ID Contato</span><span class="cell-value">${detail.contato?.id || '—'}</span></div>
    </div>

    <div class="section-title">Produtos</div>
    <table class="table">
      <thead>
        <tr>
          <th>Código</th>
          <th>Descrição</th>
          <th>UN</th>
          <th>Qtd</th>
          <th>Vl. Unit.</th>
          <th>Vl. Total</th>
          <th>CFOP</th>
          <th>CST</th>
          <th>ICMS</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>LEITE-CRU</td>
          <td>LEITE CRU</td>
          <td>LT</td>
          <td class="right">${fmt(detail.totalProdutos / 2.25)}</td>
          <td class="right">R$ 2,25</td>
          <td class="right">R$ ${fmt(detail.totalProdutos)}</td>
          <td>1101</td>
          <td>00</td>
          <td class="right">R$ ${fmt(detail.totalProdutos * 0.12)}</td>
        </tr>
      </tbody>
    </table>

    <div class="section-title">Totais</div>
    <div class="row">
      <div class="cell"><span class="cell-label">Total Produtos</span><span class="cell-value">R$ ${fmt(detail.totalProdutos)}</span></div>
      <div class="cell"><span class="cell-label">Despesas Acessórias (2,5%)</span><span class="cell-value">R$ ${fmt(detail.totalProdutos * 0.025)}</span></div>
      <div class="cell"><span class="cell-label">ICMS (12%)</span><span class="cell-value">R$ ${fmt(detail.totalProdutos * 0.12)}</span></div>
      <div class="cell"><span class="cell-label">Funrural (1,5%)</span><span class="cell-value">R$ ${fmt(detail.totalProdutos * 0.015)}</span></div>
      <div class="cell"><span class="cell-label">Valor da Nota</span><span class="cell-value">R$ ${fmt(detail.valorNota)}</span></div>
    </div>

    <div class="section-title">Observações</div>
    <div class="obs">${detail.observacoes || '—'}</div>

    <div class="footer">
      DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA (demonstração) — NFe Leite
    </div>
  </div>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}
