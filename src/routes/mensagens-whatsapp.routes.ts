import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { hojeSP, ymd } from "../utils/relogio.js";

export const enviarSchema = z.object({
  alunoId: z.number().int(),
  tipo: z.enum(["cobranca", "atraso", "boletim_pronto", "aviso_geral"]),
  mensagem: z.string().min(1),
});

export default async function mensagensWhatsappRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authorize(["admin"]));

  app.get("/", async () => {
    return app.prisma.mensagemWhatsapp.findMany({
      include: { aluno: { include: { responsavel: true } } },
      orderBy: { criadoEm: "desc" },
    });
  });

  app.post("/enviar", async (request, reply) => {
    const body = enviarSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const aluno = await app.prisma.aluno.findUnique({
      where: { id: body.data.alunoId },
      include: { responsavel: true },
    });
    if (!aluno) return reply.code(404).send({ message: "Aluno não encontrado" });

    return enviar(body.data, aluno.responsavel.telefone, reply);
  });

  app.post("/lembrete", async (request, reply) => {
    const body = z.object({ mensalidadeId: z.number().int().positive() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    const mensalidade = await app.prisma.mensalidade.findUnique({
      where: { id: body.data.mensalidadeId },
      include: { aluno: { include: { responsavel: true } } },
    });
    if (!mensalidade) return reply.code(404).send({ message: "Mensalidade não encontrada." });
    if (mensalidade.tipo !== "MENSALIDADE" || !["PENDENTE", "ATRASADO"].includes(mensalidade.status)) {
      return reply.code(409).send({ message: "Esta mensalidade não está em aberto." });
    }
    const vencimento = ymd(mensalidade.vencimento);
    const data = vencimento.split("-").reverse().join("/");
    const competencia = mensalidade.mesReferencia.split("-").reverse().join("/");
    const valor = mensalidade.valor.toNumber().toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const atrasada = vencimento < hojeSP();
    const mensagem = `Olá, ${mensalidade.aluno.responsavel.nome}! A mensalidade de ${mensalidade.aluno.nome}, referente a ${competencia}, no valor de ${valor}, ${atrasada ? "venceu" : "vence"} em ${data}. Se já efetuou o pagamento, desconsidere este lembrete. Colégio São Vicente.`;
    return enviar({ alunoId: mensalidade.alunoId, tipo: atrasada ? "atraso" : "cobranca", mensagem }, mensalidade.aluno.responsavel.telefone, reply);
  });

  async function enviar(dados: z.infer<typeof enviarSchema>, telefone: string, reply: FastifyReply) {
    const registro = await app.prisma.mensagemWhatsapp.create({
      data: { ...dados, status: "PENDENTE" },
    });

    try {
      const resposta = await fetch(`${process.env.WHATSAPP_SERVICE_URL}/enviar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ telefone, mensagem: dados.mensagem }),
      });

      const atualizado = await app.prisma.mensagemWhatsapp.update({
        where: { id: registro.id },
        data: { status: resposta.ok ? "ENVIADO" : "ERRO", enviadoEm: new Date() },
      });
      return reply.code(resposta.ok ? 201 : 502).send(atualizado);
    } catch (erro) {
      app.log.error(erro, "Falha ao chamar o whatsapp-service");
      const atualizado = await app.prisma.mensagemWhatsapp.update({
        where: { id: registro.id },
        data: { status: "ERRO" },
      });
      return reply.code(502).send(atualizado);
    }
  }
}
