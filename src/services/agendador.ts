import type { FastifyInstance } from "fastify";
import { gerarMensalidades, mesTemCobranca, obterConfiguracao } from "./cobranca.js";
import { hojeSP, horaSP } from "../utils/relogio.js";

/**
 * Geração automática de mensalidades.
 *
 * Roda uma vez por dia, a partir das 02:00 (America/Sao_Paulo), e também ao subir a API — assim
 * recupera dias em que o servidor esteve desligado e alunos reativados depois do dia 1. Rodar todo dia
 * é seguro porque a geração é idempotente e serializada por pg_advisory_xact_lock.
 *
 * Sem dependência externa: uma checagem a cada hora decide se já é hora de rodar hoje.
 */
const HORA_EXECUCAO = 2;
const INTERVALO_CHECAGEM_MS = 60 * 60 * 1000;

/** Uma passada do agendador: só gera se a cobrança automática estiver ligada e o mês tiver cobrança. */
export async function executarGeracaoAutomatica(app: FastifyInstance) {
  const config = await obterConfiguracao(app.prisma);
  const mesReferencia = hojeSP().slice(0, 7);
  if (!config.cobrancaAutomatica) return { executou: false as const, motivo: "cobrancaAutomatica desligada" };
  if (!mesTemCobranca(mesReferencia, config)) return { executou: false as const, motivo: `mês ${mesReferencia} sem cobrança` };
  return { executou: true as const, resultado: await gerarMensalidades(app.prisma, mesReferencia, app.log) };
}

export function iniciarAgendador(app: FastifyInstance) {
  let ultimoDiaExecutado: string | null = null;

  async function checar(aoSubir = false) {
    const hoje = hojeSP();
    if (ultimoDiaExecutado === hoje) return;
    if (!aoSubir && horaSP() < HORA_EXECUCAO) return;
    try {
      const r = await executarGeracaoAutomatica(app);
      if (!r.executou) app.log.info({ motivo: r.motivo }, "Geração automática de mensalidades não executada");
      ultimoDiaExecutado = hoje;
    } catch (erro) {
      app.log.error(erro, "Falha na geração automática de mensalidades (tenta de novo na próxima checagem)");
    }
  }

  void checar(true);
  const timer = setInterval(() => void checar(), INTERVALO_CHECAGEM_MS);
  timer.unref(); // não segura o processo aberto no desligamento
  return timer;
}
