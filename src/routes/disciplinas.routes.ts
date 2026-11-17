import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { normalizarNome } from "../utils/texto.js";

export const schema = z.object({ nome: z.string().trim().min(1) });

const MENSAGEM_DUPLICADA = "Já existe uma disciplina com esse nome.";

export default async function disciplinasRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /** Responde 409 se outra disciplina já usa esse nome (ignorando maiúsculas e acentos). */
  async function nomeEmUso(nomeNormalizado: string, reply: FastifyReply, ignorarId?: number) {
    const existente = await app.prisma.disciplina.findUnique({ where: { nomeNormalizado } });
    if (existente && existente.id !== ignorarId) {
      reply.code(409).send({ message: MENSAGEM_DUPLICADA });
      return true;
    }
    return false;
  }

  app.get("/", async () =>
    app.prisma.disciplina.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } })
  );

  app.post("/", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const nomeNormalizado = normalizarNome(body.data.nome);
    if (await nomeEmUso(nomeNormalizado, reply)) return;

    const disciplina = await app.prisma.disciplina.create({
      data: { nome: body.data.nome, nomeNormalizado },
      select: { id: true, nome: true },
    });
    return reply.code(201).send(disciplina);
  });

  app.patch("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = schema.partial().safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    if (body.data.nome === undefined) {
      return app.prisma.disciplina.update({ where: { id }, data: {}, select: { id: true, nome: true } });
    }

    const nomeNormalizado = normalizarNome(body.data.nome);
    if (await nomeEmUso(nomeNormalizado, reply, id)) return;

    return app.prisma.disciplina.update({
      where: { id },
      data: { nome: body.data.nome, nomeNormalizado },
      select: { id: true, nome: true },
    });
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.disciplina.delete({ where: { id } });
    return reply.code(204).send();
  });
}
