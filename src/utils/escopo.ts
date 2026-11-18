import { FastifyInstance, FastifyRequest } from "fastify";

/**
 * Escopo do professor: ele só enxerga as turmas, os alunos e as disciplinas
 * em que tem vínculo (turma_disciplina_professor). Admin não tem escopo (null = tudo).
 */
export type Escopo = {
  turmaIds: number[];
  disciplinaIds: number[];
  /** Disciplinas que o professor leciona em cada turma. */
  disciplinasDaTurma: (turmaId: number) => number[];
};

export async function escopoProfessor(app: FastifyInstance, request: FastifyRequest): Promise<Escopo | null> {
  if (request.user.perfil === "admin") return null;
  const vinculos = await app.prisma.turmaDisciplinaProfessor.findMany({
    where: { usuarioId: request.user.id },
    select: { turmaId: true, disciplinaId: true },
  });
  return {
    turmaIds: [...new Set(vinculos.map((v) => v.turmaId))],
    disciplinaIds: [...new Set(vinculos.map((v) => v.disciplinaId))],
    disciplinasDaTurma: (turmaId) => vinculos.filter((v) => v.turmaId === turmaId).map((v) => v.disciplinaId),
  };
}

export const SEM_ACESSO = { message: "Você não tem acesso a este registro." };
