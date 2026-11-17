import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export const schema = z.object({
  alunoId: z.number().int(),
  disciplinaId: z.number().int(),
  bimestre: z.number().int().min(1).max(4),
  anoLetivo: z.number().int(),
  nota: z.number().min(0).max(10),
});

export default async function notasRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  // Professor só pode lançar nota em turma+disciplina que ele leciona (turma_disciplina_professor).
  // Admin lança em qualquer turma/disciplina.
  async function podeLancar(request: FastifyRequest, alunoId: number, disciplinaId: number) {
    if (request.user.perfil === "admin") return true;

    const aluno = await app.prisma.aluno.findUnique({ where: { id: alunoId } });
    if (!aluno) return false;

    const vinculo = await app.prisma.turmaDisciplinaProfessor.findFirst({
      where: { turmaId: aluno.turmaId, disciplinaId, usuarioId: request.user.id },
    });
    return Boolean(vinculo);
  }

  app.get("/", async (request) => {
    const { alunoId } = request.query as { alunoId?: string };
    return app.prisma.nota.findMany({
      where: alunoId ? { alunoId: Number(alunoId) } : undefined,
      include: { disciplina: true, aluno: { select: { id: true, nome: true } } },
      orderBy: [{ bimestre: "asc" }],
    });
  });

  app.post("/", async (request, reply) => {
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    // Se a turma atual do aluno tem currículo definido para esse ano letivo, a disciplina precisa estar nele.
    // Turmas sem currículo cadastrado não são bloqueadas (compatibilidade com dados antigos).
    const aluno = await app.prisma.aluno.findUnique({
      where: { id: body.data.alunoId },
      select: { turma: { select: { anoLetivo: true, disciplinas: { select: { disciplinaId: true } } } } },
    });
    if (!aluno) return reply.code(404).send({ message: "Aluno não encontrado" });
    const curriculo = aluno.turma.disciplinas.map((d) => d.disciplinaId);
    if (
      aluno.turma.anoLetivo === body.data.anoLetivo &&
      curriculo.length > 0 &&
      !curriculo.includes(body.data.disciplinaId)
    ) {
      return reply.code(400).send({ message: "A disciplina não faz parte do currículo da turma." });
    }

    const autorizado = await podeLancar(request, body.data.alunoId, body.data.disciplinaId);
    if (!autorizado) return reply.code(403).send({ message: "Você não leciona essa disciplina nessa turma" });

    const nota = await app.prisma.nota.upsert({
      where: {
        alunoId_disciplinaId_bimestre_anoLetivo: {
          alunoId: body.data.alunoId,
          disciplinaId: body.data.disciplinaId,
          bimestre: body.data.bimestre,
          anoLetivo: body.data.anoLetivo,
        },
      },
      create: { ...body.data, lancadoPor: request.user.id },
      update: { nota: body.data.nota, lancadoPor: request.user.id },
    });
    return reply.code(201).send(nota);
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.nota.delete({ where: { id } });
    return reply.code(204).send();
  });
}
