import { Prisma, PrismaClient, StatusMensalidade, TipoCobranca, TipoDesconto } from "@prisma/client";
import { dataCalendario, dataNoMes, hojeSP, somarDias, ultimoDiaDoMes, ymd } from "../utils/relogio.js";

/**
 * Regras de cobrança da escola. TODO cálculo de valor, desconto, vencimento e situação passa por
 * aqui — geração mensal, matrícula, mudança de turma, "aplicar às pendentes" e edição manual —
 * para que os caminhos nunca divirjam.
 */

type Db = PrismaClient | Prisma.TransactionClient;
type Logger = { info: (obj: object, msg?: string) => void };

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

/** Status que ainda podem ser recalculados/editados. PAGO nunca muda. */
export const STATUS_NAO_PAGOS: StatusMensalidade[] = ["PENDENTE", "ATRASADO", "ISENTO"];

/** Chave do pg_advisory_xact_lock que serializa a geração mensal entre instâncias da API. */
const LOCK_GERACAO = 4_242_001;

export type DescontoAluno = {
  tipoDesconto: TipoDesconto | null;
  valorDesconto: Prisma.Decimal | null;
  descontoAte: Date | null;
};

// ---------------------------------------------------------------- configuração

/** Configuração da escola (linha única). Cria com os padrões se ainda não existir. */
export async function obterConfiguracao(db: Db) {
  return (await db.configuracao.findUnique({ where: { id: 1 } })) ?? db.configuracao.create({ data: { id: 1 } });
}
export type Config = Awaited<ReturnType<typeof obterConfiguracao>>;

// ---------------------------------------------------------------- cálculo

/** Desconto em R$ do aluno sobre `valorOriginal`, se vigente na data de vencimento. */
export function calcularDesconto(valorOriginal: Prisma.Decimal, aluno: DescontoAluno, vencimento: string) {
  if (!aluno.tipoDesconto) return ZERO;
  if (aluno.descontoAte && ymd(aluno.descontoAte) < vencimento) return ZERO; // validade vencida

  switch (aluno.tipoDesconto) {
    case "BOLSA_INTEGRAL":
      return valorOriginal;
    case "PERCENTUAL":
      return valorOriginal
        .mul(aluno.valorDesconto ?? 0)
        .div(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    case "VALOR":
      return Prisma.Decimal.min(aluno.valorDesconto ?? 0, valorOriginal);
  }
}

/** ISENTO se o valor é zero; ATRASADO se o vencimento já passou; senão PENDENTE. */
export function statusDerivado(valor: Prisma.Decimal, vencimento: string, hoje = hojeSP()): StatusMensalidade {
  if (valor.lte(0)) return "ISENTO";
  return vencimento < hoje ? "ATRASADO" : "PENDENTE";
}

/** Valores congelados de uma cobrança: original, desconto (≤ original), valor final (≥ 0) e situação. */
export function montarValores(valorOriginal: Prisma.Decimal.Value, desconto: Prisma.Decimal.Value, vencimento: string, hoje = hojeSP()) {
  const original = D(valorOriginal);
  const descontoFinal = Prisma.Decimal.min(Prisma.Decimal.max(D(desconto), 0), original);
  const valor = original.sub(descontoFinal);
  return { valorOriginal: original, desconto: descontoFinal, valor, status: statusDerivado(valor, vencimento, hoje) };
}

/** Cobrança completa a partir do valor cheio e do desconto do aluno (ou nenhum). */
export function calcularCobranca(valorOriginal: Prisma.Decimal.Value, aluno: DescontoAluno | null, vencimento: string, hoje = hojeSP()) {
  const original = D(valorOriginal);
  const desconto = aluno ? calcularDesconto(original, aluno, vencimento) : ZERO;
  return montarValores(original, desconto, vencimento, hoje);
}

// ---------------------------------------------------------------- datas

/** Vencimento da mensalidade de "AAAA-MM": dia do aluno ou padrão, limitado ao último dia do mês. */
export function vencimentoMensalidade(mesReferencia: string, diaAluno: number | null, config: Config) {
  const [ano, mes] = mesReferencia.split("-").map(Number);
  return dataNoMes(ano, mes, diaAluno ?? config.diaVencimentoPadrao);
}

/** Último dia do período de matrícula no ano ("AAAA-MM-DD"). */
export function fimPeriodoMatricula(config: Config, ano: number) {
  if (config.periodoMatriculaAte) {
    const [mes, dia] = config.periodoMatriculaAte.split("-").map(Number);
    return dataNoMes(ano, mes, dia);
  }
  // null = até o fim do 1º mês com mensalidade.
  const primeiroMes = [...config.mesesCobranca].sort((a, b) => a - b)[0] ?? 1;
  return dataNoMes(ano, primeiroMes, ultimoDiaDoMes(ano, primeiroMes));
}

export const mesDe = (data: string) => data.slice(0, 7);
export const mesTemCobranca = (mesReferencia: string, config: Config) =>
  config.mesesCobranca.includes(Number(mesReferencia.slice(5, 7)));

// ---------------------------------------------------------------- geração mensal

export type ResultadoGeracao = {
  mesReferencia: string;
  criadas: number;
  jaExistiam: number;
  isentas: number;
  ignoradas: { mesSemCobranca: number; alunoInativo: number; matriculadoDepois: number };
  aviso?: string;
};

/**
 * Cria as mensalidades que faltam no mês para todos os alunos ATIVO. Idempotente: pode rodar quantas
 * vezes for preciso (índice único + skipDuplicates). Serializada por pg_advisory_xact_lock.
 */
export async function gerarMensalidades(prisma: PrismaClient, mesReferencia: string, log?: Logger): Promise<ResultadoGeracao> {
  const resultado = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${LOCK_GERACAO})`;

      const config = await obterConfiguracao(tx);
      const [ativos, inativos] = await Promise.all([
        tx.aluno.findMany({ where: { status: "ATIVO" }, include: { turma: true } }),
        tx.aluno.count({ where: { status: "INATIVO" } }),
      ]);
      const base: ResultadoGeracao = {
        mesReferencia,
        criadas: 0,
        jaExistiam: 0,
        isentas: 0,
        ignoradas: { mesSemCobranca: 0, alunoInativo: inativos, matriculadoDepois: 0 },
      };

      if (!mesTemCobranca(mesReferencia, config)) {
        base.ignoradas.mesSemCobranca = ativos.length;
        base.aviso = `O mês ${mesReferencia.slice(5, 7)} não está entre os meses com mensalidade (${config.mesesCobranca.join(", ")}).`;
        return base;
      }

      // Aluno matriculado depois do fim do mês não deve esse mês.
      const [ano, mes] = mesReferencia.split("-").map(Number);
      const fimDoMes = dataNoMes(ano, mes, 31);
      const elegiveis = ativos.filter((a) => ymd(a.matriculaEm) <= fimDoMes);
      base.ignoradas.matriculadoDepois = ativos.length - elegiveis.length;

      const existentes = await tx.mensalidade.findMany({
        where: { mesReferencia, tipo: "MENSALIDADE", alunoId: { in: elegiveis.map((a) => a.id) } },
        select: { alunoId: true },
      });
      const jaTem = new Set(existentes.map((m) => m.alunoId));
      base.jaExistiam = jaTem.size;

      const novas = elegiveis
        .filter((a) => !jaTem.has(a.id))
        .map((a) => {
          const vencimento = vencimentoMensalidade(mesReferencia, a.diaVencimento, config);
          const v = calcularCobranca(a.turma.valorMensalidade, a, vencimento);
          return { alunoId: a.id, tipo: "MENSALIDADE" as const, mesReferencia, vencimento: dataCalendario(vencimento), ...v };
        });

      const criadas = await tx.mensalidade.createMany({ data: novas, skipDuplicates: true });
      base.criadas = criadas.count;
      // Corrida rara: outra transação criou entre a leitura e o insert → conta como já existente.
      base.jaExistiam += novas.length - criadas.count;
      base.isentas = novas.filter((n) => n.status === "ISENTO").length;
      return base;
    },
    { timeout: 60_000 }
  );

  log?.info(
    { mesReferencia, criadas: resultado.criadas, jaExistiam: resultado.jaExistiam, isentas: resultado.isentas, ignoradas: resultado.ignoradas },
    "Geração de mensalidades"
  );
  return resultado;
}

// ---------------------------------------------------------------- cadastro do aluno

type AlunoParaCobranca = DescontoAluno & { id: number; diaVencimento: number | null; turma: { valorMensalidade: Prisma.Decimal } };

const selecionarCriada = { id: true, tipo: true, mesReferencia: true, valor: true, status: true } as const;

/**
 * Cobranças geradas ao cadastrar um aluno (mesma transação do cadastro):
 * - dentro do período de matrícula e com cobrarMatricula → MATRICULA;
 * - fora do período → MENSALIDADE do mês corrente, se o mês tem cobrança e a automática está ligada.
 */
export async function cobrancasDoCadastro(tx: Prisma.TransactionClient, aluno: AlunoParaCobranca, hoje = hojeSP()) {
  const config = await obterConfiguracao(tx);
  const ano = Number(hoje.slice(0, 4));
  const noPeriodo = hoje <= fimPeriodoMatricula(config, ano);

  if (noPeriodo) {
    if (!config.cobrarMatricula || !config.valorMatricula) return [];
    const ja = await tx.mensalidade.findFirst({
      where: { alunoId: aluno.id, tipo: "MATRICULA", mesReferencia: { startsWith: `${ano}-` } },
    });
    if (ja) return [];
    const vencimento = somarDias(hoje, config.diasVencimentoMatricula);
    const v = calcularCobranca(config.valorMatricula, config.descontoNaMatricula ? aluno : null, vencimento, hoje);
    const criada = await tx.mensalidade.create({
      data: { alunoId: aluno.id, tipo: "MATRICULA", mesReferencia: mesDe(hoje), vencimento: dataCalendario(vencimento), ...v },
      select: selecionarCriada,
    });
    return [criada];
  }

  const mesReferencia = mesDe(hoje);
  if (!config.cobrancaAutomatica || !mesTemCobranca(mesReferencia, config)) return [];
  const vencimento = vencimentoMensalidade(mesReferencia, aluno.diaVencimento, config);
  const v = calcularCobranca(aluno.turma.valorMensalidade, aluno, vencimento, hoje);
  const criada = await tx.mensalidade.create({
    data: { alunoId: aluno.id, tipo: "MENSALIDADE", mesReferencia, vencimento: dataCalendario(vencimento), ...v },
    select: selecionarCriada,
  });
  return [criada];
}

// ---------------------------------------------------------------- recálculo

/**
 * Recalcula as cobranças não pagas (PENDENTE, ATRASADO, ISENTO) do aluno com o desconto atual.
 * - `valorTurma`: novo valor cheio das MENSALIDADES (mudança de turma). Matrícula mantém o valor cheio.
 * - `recalcularVencimento`: aplica o dia de vencimento atual às MENSALIDADES.
 * Cobranças PAGO nunca são tocadas.
 */
export async function recalcularNaoPagas(
  tx: Prisma.TransactionClient,
  aluno: AlunoParaCobranca,
  opcoes: { valorTurma?: Prisma.Decimal; recalcularVencimento: boolean },
  hoje = hojeSP()
) {
  const config = await obterConfiguracao(tx);
  const cobrancas = await tx.mensalidade.findMany({ where: { alunoId: aluno.id, status: { in: STATUS_NAO_PAGOS } } });

  for (const c of cobrancas) {
    const ehMensalidade = c.tipo === "MENSALIDADE";
    const vencimento =
      ehMensalidade && opcoes.recalcularVencimento
        ? vencimentoMensalidade(c.mesReferencia, aluno.diaVencimento, config)
        : ymd(c.vencimento);
    const valorOriginal = ehMensalidade && opcoes.valorTurma ? opcoes.valorTurma : c.valorOriginal;
    const usaDesconto = ehMensalidade || config.descontoNaMatricula;
    const v = calcularCobranca(valorOriginal, usaDesconto ? aluno : null, vencimento, hoje);

    await tx.mensalidade.update({ where: { id: c.id }, data: { vencimento: dataCalendario(vencimento), ...v } });
  }
  return cobrancas.length;
}

export type { TipoCobranca };
