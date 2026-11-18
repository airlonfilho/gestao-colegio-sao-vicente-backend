import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { limparBanco } from "./helpers/db.js";
import { criarUsuario, logar, criarTurma, criarDisciplina, criarResponsavel, criarAluno, vincularProfessor } from "./helpers/fixtures.js";

const prisma = new PrismaClient();
const app = buildApp();

let admin: string;
let professor: string;
let professorId: number;

beforeEach(async () => {
  await limparBanco(prisma);
  await criarUsuario(prisma, { email: "admin@teste.com", perfil: "admin" });
  professorId = (await criarUsuario(prisma, { email: "prof@teste.com", perfil: "professor" })).id;
  admin = await logar(app, "admin@teste.com");
  professor = await logar(app, "prof@teste.com");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const req = (token: string, method: "GET" | "POST", url: string) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${token}` } });

/** Professor leciona Matemática na turma A; turma B e Português ficam fora do escopo dele. */
async function cenario() {
  const turmaA = await criarTurma(prisma, { nome: "Turma A" });
  const turmaB = await criarTurma(prisma, { nome: "Turma B" });
  const mat = await criarDisciplina(prisma, "Matemática");
  const port = await criarDisciplina(prisma, "Português");
  for (const t of [turmaA, turmaB]) {
    await prisma.turmaDisciplina.createMany({ data: [{ turmaId: t.id, disciplinaId: mat.id }, { turmaId: t.id, disciplinaId: port.id }] });
  }
  await vincularProfessor(prisma, professorId, turmaA.id, mat.id);
  const resp = await criarResponsavel(prisma, "escopo");
  const alunoA = await criarAluno(prisma, { turmaId: turmaA.id, responsavelId: resp.id, nome: "Aluno A" });
  const alunoB = await criarAluno(prisma, { turmaId: turmaB.id, responsavelId: resp.id, nome: "Aluno B" });
  await prisma.nota.createMany({
    data: [
      { alunoId: alunoA.id, disciplinaId: mat.id, bimestre: 1, anoLetivo: 2026, nota: 8, lancadoPor: professorId },
      { alunoId: alunoA.id, disciplinaId: port.id, bimestre: 1, anoLetivo: 2026, nota: 7, lancadoPor: professorId },
      { alunoId: alunoB.id, disciplinaId: mat.id, bimestre: 1, anoLetivo: 2026, nota: 6, lancadoPor: professorId },
    ],
  });
  return { turmaA, turmaB, mat, port, alunoA, alunoB };
}

describe("Professor só vê turmas, alunos e disciplinas vinculados a ele", () => {
  it("listas trazem só o que está no escopo; admin vê tudo", async () => {
    const { turmaA, mat, alunoA } = await cenario();

    const turmas = (await req(professor, "GET", "/turmas")).json();
    expect(turmas.map((t: { id: number }) => t.id)).toEqual([turmaA.id]);
    expect(turmas[0].disciplinaIds).toEqual([mat.id]);

    expect((await req(professor, "GET", "/alunos")).json().map((a: { id: number }) => a.id)).toEqual([alunoA.id]);
    expect((await req(professor, "GET", "/disciplinas")).json().map((d: { id: number }) => d.id)).toEqual([mat.id]);
    expect((await req(professor, "GET", "/turma-disciplina-professor")).json()).toHaveLength(1);

    const notas = (await req(professor, "GET", "/notas")).json();
    expect(notas).toHaveLength(1);
    expect(notas[0]).toMatchObject({ alunoId: alunoA.id, disciplinaId: mat.id });

    expect((await req(admin, "GET", "/turmas")).json()).toHaveLength(2);
    expect((await req(admin, "GET", "/alunos")).json()).toHaveLength(2);
    expect((await req(admin, "GET", "/disciplinas")).json()).toHaveLength(2);
  });

  it("turma e aluno fora do escopo dão 403", async () => {
    const { turmaA, turmaB, alunoA, alunoB } = await cenario();
    expect((await req(professor, "GET", `/turmas/${turmaA.id}/alunos`)).statusCode).toBe(200);
    expect((await req(professor, "GET", `/turmas/${turmaB.id}/alunos`)).statusCode).toBe(403);
    expect((await req(professor, "GET", `/alunos/${alunoA.id}`)).statusCode).toBe(200);
    expect((await req(professor, "GET", `/alunos/${alunoB.id}`)).statusCode).toBe(403);
    expect((await req(professor, "GET", `/alunos/${alunoB.id}/boletim`)).statusCode).toBe(403);
  });

  it("boletim mostra só as disciplinas que o professor leciona na turma", async () => {
    const { mat, alunoA } = await cenario();
    const boletim = (await req(professor, "GET", `/alunos/${alunoA.id}/boletim`)).json();
    expect(boletim.aluno.turma.disciplinaIds).toEqual([mat.id]);
    expect(boletim.notas.map((n: { disciplinaId: number }) => n.disciplinaId)).toEqual([mat.id]);

    const doAdmin = (await req(admin, "GET", `/alunos/${alunoA.id}/boletim`)).json();
    expect(doAdmin.notas).toHaveLength(2);
  });

  it("responsáveis e WhatsApp são só do admin", async () => {
    for (const url of ["/responsaveis", "/mensagens-whatsapp"]) {
      expect((await req(professor, "GET", url)).statusCode, url).toBe(403);
      expect((await req(admin, "GET", url)).statusCode, url).toBe(200);
    }
  });

  it("professor sem vínculo não vê nada", async () => {
    await cenario();
    await prisma.turmaDisciplinaProfessor.deleteMany();
    for (const url of ["/turmas", "/alunos", "/disciplinas", "/notas"]) {
      expect((await req(professor, "GET", url)).json(), url).toEqual([]);
    }
  });
});
