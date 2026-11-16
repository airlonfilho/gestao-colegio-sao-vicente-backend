import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { limparBanco } from "./helpers/db.js";
import { criarUsuario, logar, criarTurma, criarDisciplina, criarResponsavel, criarAluno } from "./helpers/fixtures.js";

const prisma = new PrismaClient();
const app = buildApp();

beforeEach(async () => {
  await limparBanco(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("Autorização de /notas", () => {
  async function cenarioBase() {
    const turma = await criarTurma(prisma);
    const disciplina = await criarDisciplina(prisma);
    const responsavel = await criarResponsavel(prisma, "notas");
    const aluno = await criarAluno(prisma, { turmaId: turma.id, responsavelId: responsavel.id });
    return { turma, disciplina, aluno };
  }

  it("admin lança nota em qualquer turma/disciplina", async () => {
    await criarUsuario(prisma, { email: "admin@teste.com", senha: "123456", perfil: "admin" });
    const token = await logar(app, "admin@teste.com");
    const { disciplina, aluno } = await cenarioBase();

    const resposta = await app.inject({
      method: "POST",
      url: "/notas",
      headers: { authorization: `Bearer ${token}` },
      payload: { alunoId: aluno.id, disciplinaId: disciplina.id, bimestre: 1, anoLetivo: 2026, nota: 9 },
    });

    expect(resposta.statusCode).toBe(201);
  });

  it("professor SEM vínculo na turma+disciplina recebe 403", async () => {
    await criarUsuario(prisma, { email: "prof@teste.com", senha: "123456", perfil: "professor" });
    const token = await logar(app, "prof@teste.com");
    const { disciplina, aluno } = await cenarioBase();

    const resposta = await app.inject({
      method: "POST",
      url: "/notas",
      headers: { authorization: `Bearer ${token}` },
      payload: { alunoId: aluno.id, disciplinaId: disciplina.id, bimestre: 1, anoLetivo: 2026, nota: 9 },
    });

    expect(resposta.statusCode).toBe(403);
  });

  it("professor COM vínculo na turma+disciplina consegue lançar", async () => {
    const professor = await criarUsuario(prisma, { email: "prof2@teste.com", senha: "123456", perfil: "professor" });
    const token = await logar(app, "prof2@teste.com");
    const { turma, disciplina, aluno } = await cenarioBase();

    await prisma.turmaDisciplinaProfessor.create({
      data: { turmaId: turma.id, disciplinaId: disciplina.id, usuarioId: professor.id },
    });

    const resposta = await app.inject({
      method: "POST",
      url: "/notas",
      headers: { authorization: `Bearer ${token}` },
      payload: { alunoId: aluno.id, disciplinaId: disciplina.id, bimestre: 1, anoLetivo: 2026, nota: 7.5 },
    });

    expect(resposta.statusCode).toBe(201);
  });

  it("lançar a mesma nota de novo sobrescreve (upsert), não duplica", async () => {
    await criarUsuario(prisma, { email: "admin2@teste.com", senha: "123456", perfil: "admin" });
    const token = await logar(app, "admin2@teste.com");
    const { disciplina, aluno } = await cenarioBase();

    const payload = { alunoId: aluno.id, disciplinaId: disciplina.id, bimestre: 1, anoLetivo: 2026, nota: 6 };
    await app.inject({ method: "POST", url: "/notas", headers: { authorization: `Bearer ${token}` }, payload });
    await app.inject({
      method: "POST",
      url: "/notas",
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, nota: 9 },
    });

    const notas = await prisma.nota.findMany({ where: { alunoId: aluno.id } });
    expect(notas).toHaveLength(1);
    expect(Number(notas[0].nota)).toBe(9);
  });

  it("turmas só podem ser criadas por admin (professor recebe 403)", async () => {
    await criarUsuario(prisma, { email: "prof3@teste.com", senha: "123456", perfil: "professor" });
    const token = await logar(app, "prof3@teste.com");

    const resposta = await app.inject({
      method: "POST",
      url: "/turmas",
      headers: { authorization: `Bearer ${token}` },
      payload: { nome: "Turma X", nivelEnsino: "Fundamental", anoLetivo: 2026, valorMensalidade: 100 },
    });

    expect(resposta.statusCode).toBe(403);
  });
});
