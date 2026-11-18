import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { hojeSP, ymd } from "../utils/relogio.js";
import { enviarTexto, ErroWhatsapp } from "../services/whatsapp.js";

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

    // Envio pela Evolution API (services/whatsapp). Falhou → registro fica com ERRO e a resposta explica o motivo.
    try {
      await enviarTexto(telefone, dados.mensagem);
      const atualizado = await app.prisma.mensagemWhatsapp.update({
        where: { id: registro.id },
        data: { status: "ENVIADO", enviadoEm: new Date() },
      });
      return reply.code(201).send(atualizado);
    } catch (erro) {
      app.log.error(erro, "Falha ao enviar pelo WhatsApp (Evolution API)");
      const atualizado = await app.prisma.mensagemWhatsapp.update({
        where: { id: registro.id },
        data: { status: "ERRO" },
      });
      const message = erro instanceof ErroWhatsapp ? erro.message : "Não foi possível enviar pelo WhatsApp.";
      return reply.code(502).send({ ...atualizado, message });
    }
  }
}
