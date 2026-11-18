import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { hashSenha } from "../../src/utils/hash.js";
import { normalizarNome } from "../../src/utils/texto.js";

export async function criarUsuario(
  prisma: PrismaClient,
  dados: { nome?: string; email: string; senha?: string; perfil: "admin" | "professor" }
) {
  return prisma.usuario.create({
    data: {
      nome: dados.nome ?? "Usuário de Teste",
      email: dados.email,
      senhaHash: await hashSenha(dados.senha ?? "123456"),
      perfil: dados.perfil,
    },
  });
}

export async function logar(app: FastifyInstance, email: string, senha = "123456") {
  const resposta = await app.inject({ method: "POST", url: "/auth/login", payload: { email, senha } });
  return JSON.parse(resposta.body).token as string;
}

export async function criarTurma(prisma: PrismaClient, dados: Partial<{ nome: string; nivelEnsino: string; anoLetivo: number; valorMensalidade: number }> = {}) {
  return prisma.turma.create({
    data: {
      nome: dados.nome ?? "Turma de Teste",
      nivelEnsino: dados.nivelEnsino ?? "Ensino Fundamental",
      anoLetivo: dados.anoLetivo ?? 2026,
      valorMensalidade: dados.valorMensalidade ?? 1000,
    },
  });
}

export async function criarDisciplina(prisma: PrismaClient, nome = "Disciplina de Teste") {
  return prisma.disciplina.create({ data: { nome, nomeNormalizado: normalizarNome(nome) } });
}

export async function criarResponsavel(prisma: PrismaClient, sufixo: string) {
  return prisma.responsavel.create({
    data: {
      nome: `Responsável ${sufixo}`,
      cpf: "11144477735",
      telefone: "11999998888",
    },
  });
}

export async function criarAluno(
  prisma: PrismaClient,
  dados: { turmaId: number; responsavelId: number; nome?: string; status?: "ATIVO" | "INATIVO" }
) {
  return prisma.aluno.create({
    data: {
      nome: dados.nome ?? "Aluno de Teste",
      turmaId: dados.turmaId,
      responsavelId: dados.responsavelId,
      status: dados.status ?? "ATIVO",
    },
  });
}

/** Vincula o professor à turma numa disciplina (cria a disciplina se não vier). */
export async function vincularProfessor(prisma: PrismaClient, usuarioId: number, turmaId: number, disciplinaId?: number) {
  const id = disciplinaId ?? (await criarDisciplina(prisma, `Disciplina ${turmaId}-${usuarioId}-${Date.now()}`)).id;
  await prisma.turmaDisciplinaProfessor.create({ data: { usuarioId, turmaId, disciplinaId: id } });
  return id;
}
