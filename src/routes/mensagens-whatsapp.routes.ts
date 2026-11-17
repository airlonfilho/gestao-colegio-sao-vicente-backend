import { FastifyInstance } from "fastify";
import { z } from "zod";
import { incluirResponsavel } from "../utils/privacidade.js";

export const enviarSchema = z.object({
  alunoId: z.number().int(),
  tipo: z.enum(["cobranca", "atraso", "boletim_pronto", "aviso_geral"]),
  mensagem: z.string().min(1),
});

export default async function mensagensWhatsappRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    return app.prisma.mensagemWhatsapp.findMany({
      include: { aluno: { include: { responsavel: incluirResponsavel(request.user.perfil) } } },
      orderBy: { criadoEm: "desc" },
    });
  });

  app.post("/enviar", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = enviarSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const aluno = await app.prisma.aluno.findUnique({
      where: { id: body.data.alunoId },
      include: { responsavel: true },
    });
    if (!aluno) return reply.code(404).send({ message: "Aluno não encontrado" });

    const registro = await app.prisma.mensagemWhatsapp.create({
      data: { alunoId: aluno.id, tipo: body.data.tipo, mensagem: body.data.mensagem, status: "PENDENTE" },
    });

    try {
      const resposta = await fetch(`${process.env.WHATSAPP_SERVICE_URL}/enviar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ telefone: aluno.responsavel.telefone, mensagem: body.data.mensagem }),
      });

      const atualizado = await app.prisma.mensagemWhatsapp.update({
        where: { id: registro.id },
        data: { status: resposta.ok ? "ENVIADO" : "ERRO", enviadoEm: new Date() },
      });
      return reply.code(201).send(atualizado);
    } catch (erro) {
      app.log.error(erro, "Falha ao chamar o whatsapp-service");
      const atualizado = await app.prisma.mensagemWhatsapp.update({
        where: { id: registro.id },
        data: { status: "ERRO" },
      });
      return reply.code(502).send(atualizado);
    }
  });
}
