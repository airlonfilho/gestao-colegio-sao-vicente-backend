import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { textoOpcional } from "../utils/zod.js";
import { incluirResponsavel } from "../utils/privacidade.js";

/** Mesmas opções do select do frontend (src/schema.ts). */
export const NIVEIS_ENSINO = ["Infantil", "Fundamental I", "Fundamental II", "Ensino Médio"] as const;

export const schema = z.object({
  nome: z.string().min(1),
  nivelEnsino: z.enum(NIVEIS_ENSINO, {
    errorMap: () => ({ message: "Nível de ensino inválido. Use: " + NIVEIS_ENSINO.join(", ") }),
  }),
  sala: textoOpcional,
  anoLetivo: z.number().int(),
  valorMensalidade: z.number().positive(),
  /** Currículo da turma. Ao enviar, substitui a lista inteira; omitir mantém a atual. */
  disciplinaIds: z.array(z.number().int()).optional(),
});

/** Achata o include `disciplinas: [{ disciplinaId }]` em `disciplinaIds: number[]`, formato usado pelo frontend. */
export function comDisciplinaIds<T extends { disciplinas: { disciplinaId: number }[] }>(turma: T) {
  const { disciplinas, ...resto } = turma;
  return { ...resto, disciplinaIds: disciplinas.map((d) => d.disciplinaId).sort((a, b) => a - b) };
}

export const includeCurriculo = { disciplinas: { select: { disciplinaId: true } } } as const;

export default async function turmasRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  /** Retorna os IDs sem duplicatas, ou responde 400 se algum não existir. */
  async function validarDisciplinas(ids: number[] | undefined, reply: FastifyReply) {
    if (ids === undefined) return undefined;
    const unicos = [...new Set(ids)];
    const encontradas = await app.prisma.disciplina.count({ where: { id: { in: unicos } } });
    if (encontradas !== unicos.length) {
      reply.code(400).send({ message: "Selecione disciplinas cadastradas." });
      return null;
    }
    return unicos;
  }

  app.get("/", async () => {
    const turmas = await app.prisma.turma.findMany({
      include: { _count: { select: { alunos: true } }, ...includeCurriculo },
      orderBy: { nome: "asc" },
    });
    return turmas.map(comDisciplinaIds);
  });

  // Mesmo formato de GET /alunos: cada aluno com turma e responsavel.
  app.get("/:id/alunos", async (request) => {
    const id = Number((request.params as { id: string }).id);
    return app.prisma.aluno.findMany({
      where: { turmaId: id },
      include: { turma: true, responsavel: incluirResponsavel(request.user.perfil) },
      orderBy: { nome: "asc" },
    });
  });

  app.post("/", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const { disciplinaIds, ...dados } = body.data;
    const ids = await validarDisciplinas(disciplinaIds, reply);
    if (ids === null) return;

    const turma = await app.prisma.turma.create({
      data: { ...dados, disciplinas: { create: (ids ?? []).map((disciplinaId) => ({ disciplinaId })) } },
      include: includeCurriculo,
    });
    return reply.code(201).send(comDisciplinaIds(turma));
  });

  app.patch("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = schema.partial().safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const { disciplinaIds, ...dados } = body.data;
    const ids = await validarDisciplinas(disciplinaIds, reply);
    if (ids === null) return;

    // Ao tirar uma disciplina do currículo, os vínculos de professor dela nessa turma saem junto
    // (decisão de produto: vínculo fora do currículo não tem uso). Tudo numa transação.
    const turma = await app.prisma.$transaction(async (tx) => {
      if (ids) {
        await tx.turmaDisciplinaProfessor.deleteMany({
          where: { turmaId: id, disciplinaId: { notIn: ids } },
        });
      }
      return tx.turma.update({
        where: { id },
        data: {
          ...dados,
          ...(ids ? { disciplinas: { deleteMany: {}, create: ids.map((disciplinaId) => ({ disciplinaId })) } } : {}),
        },
        include: includeCurriculo,
      });
    });
    return comDisciplinaIds(turma);
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.turma.delete({ where: { id } });
    return reply.code(204).send();
  });
}
