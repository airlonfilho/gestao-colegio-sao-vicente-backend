import { FastifyInstance } from "fastify";
import { z } from "zod";
import { obterConfiguracao } from "../services/cobranca.js";
import { ultimoDiaDoMes } from "../utils/relogio.js";

const mesDia = z
  .string()
  .regex(/^\d{2}-\d{2}$/, { message: 'Use o formato "MM-DD".' })
  .refine((v) => {
    const [mes, dia] = v.split("-").map(Number);
    return mes >= 1 && mes <= 12 && dia >= 1 && dia <= ultimoDiaDoMes(2024, mes); // 2024: aceita 02-29
  }, { message: "Data inválida." });

export const configuracaoSchema = z
  .object({
    diaVencimentoPadrao: z.number().int().min(1, { message: "Dia de 1 a 31." }).max(31, { message: "Dia de 1 a 31." }),
    mesesCobranca: z
      .array(z.number().int().min(1, { message: "Mês de 1 a 12." }).max(12, { message: "Mês de 1 a 12." }))
      .transform((meses) => [...new Set(meses)].sort((a, b) => a - b)),
    cobrancaAutomatica: z.boolean(),
    cobrarMatricula: z.boolean(),
    valorMatricula: z.number().positive({ message: "Valor da matrícula deve ser maior que zero." }).nullable(),
    diasVencimentoMatricula: z.number().int().min(0).max(90),
    periodoMatriculaAte: mesDia.nullable(),
    descontoNaMatricula: z.boolean(),
  })
  .partial()
  .strict();

export default async function configuracoesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authorize(["admin"]));

  app.get("/", async () => obterConfiguracao(app.prisma));

  app.patch("/", async (request, reply) => {
    const body = configuracaoSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const atual = await obterConfiguracao(app.prisma);
    const cobrarMatricula = body.data.cobrarMatricula ?? atual.cobrarMatricula;
    const valorMatricula = body.data.valorMatricula !== undefined ? body.data.valorMatricula : atual.valorMatricula;
    if (cobrarMatricula && !valorMatricula) {
      return reply.code(400).send({
        message: "Informe o valor da matrícula para cobrar matrícula.",
        fieldErrors: { valorMatricula: ["Obrigatório quando cobrarMatricula está ligado."] },
      });
    }

    return app.prisma.configuracao.update({ where: { id: 1 }, data: body.data });
  });
}
