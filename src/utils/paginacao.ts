const TAMANHO_PADRAO = 20;
const TAMANHO_MAXIMO = 100;

export interface Paginacao {
  pagina: number;
  tamanhoPagina: number;
  skip: number;
  take: number;
}

/**
 * Só ativa a paginação quando o client manda `pagina` na query — mantém
 * `GET /alunos` e `GET /mensalidades` retornando um array puro (contrato atual)
 * para quem não pede paginação, e `{ dados, total, pagina, totalPaginas }`
 * para quem pede.
 */
export function lerPaginacao(query: Record<string, unknown>): Paginacao | null {
  if (query.pagina === undefined) return null;

  const pagina = Math.max(1, Number(query.pagina) || 1);
  const tamanhoSolicitado = Number(query.tamanhoPagina) || TAMANHO_PADRAO;
  const tamanhoPagina = Math.min(Math.max(1, tamanhoSolicitado), TAMANHO_MAXIMO);

  return { pagina, tamanhoPagina, skip: (pagina - 1) * tamanhoPagina, take: tamanhoPagina };
}

export function paginar<T>(dados: T[], total: number, paginacao: Paginacao) {
  return {
    dados,
    total,
    pagina: paginacao.pagina,
    totalPaginas: Math.max(1, Math.ceil(total / paginacao.tamanhoPagina)),
  };
}
