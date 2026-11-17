import { FastifyInstance } from "fastify";
import { z } from "zod";

export const schema = z.object({
  turmaId: z.number().int(),
  disciplinaId: z.number().int(),
  usuarioId: z.number().int(),
});

export default async function turmaDisciplinaProfessorRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async () => {
    return app.prisma.turmaDisciplinaProfessor.findMany({
      include: { turma: true, disciplina: true, professor: { select: { id: true, nome: true } } },
    });
  });

  app.post("/", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    const { turmaId, disciplinaId, usuarioId } = body.data;

    const turma = await app.prisma.turma.findUnique({
      where: { id: turmaId },
      select: { disciplinas: { select: { disciplinaId: true } } },
    });
    if (!turma) return reply.code(400).send({ message: "Turma não encontrada." });

    // Turmas com currículo só aceitam vínculo em disciplina do currículo (mesma regra de POST /notas).
    const curriculo = turma.disciplinas.map((d) => d.disciplinaId);
    if (curriculo.length > 0 && !curriculo.includes(disciplinaId)) {
      return reply.code(400).send({ message: "A disciplina não faz parte do currículo da turma." });
    }

    // A turma+disciplina só pode ter um professor: explica qual é o conflito.
    const existente = await app.prisma.turmaDisciplinaProfessor.findUnique({
      where: { turmaId_disciplinaId: { turmaId, disciplinaId } },
      include: { professor: { select: { nome: true } } },
    });
    if (existente) {
      return reply.code(409).send({
        message:
          existente.usuarioId === usuarioId
            ? "Esse professor já está vinculado a essa disciplina nessa turma."
            : `Essa disciplina já tem professor nessa turma (${existente.professor.nome}). Remova o vínculo atual antes.`,
      });
    }

    const vinculo = await app.prisma.turmaDisciplinaProfessor.create({ data: body.data });
    return reply.code(201).send(vinculo);
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.turmaDisciplinaProfessor.delete({ where: { id } });
    return reply.code(204).send();
  });
}
