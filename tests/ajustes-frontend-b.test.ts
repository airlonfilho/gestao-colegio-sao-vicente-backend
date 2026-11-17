import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp, mensagemDuplicidade } from "../src/app.js";
import { limparBanco } from "./helpers/db.js";
import { criarUsuario, logar, criarDisciplina, criarResponsavel, criarAluno } from "./helpers/fixtures.js";

/** Ajustes B1–B5 e D1 pedidos pelo frontend. */

const prisma = new PrismaClient();
const app = buildApp();

let admin: string;
let professor: string;
let professorId: number;

beforeEach(async () => {
  await limparBanco(prisma);
  await criarUsuario(prisma, { email: "admin@teste.com", perfil: "admin" });
  professorId = (await criarUsuario(prisma, { nome: "Prof. Ana", email: "prof@teste.com", perfil: "professor" })).id;
  admin = await logar(app, "admin@teste.com");
  professor = await logar(app, "prof@teste.com");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function req(token: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) {
  return app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
}

const turmaBase = { nome: "6º Ano A", nivelEnsino: "Fundamental II", anoLetivo: 2026, valorMensalidade: 800 };

describe("B1 · GET /turmas/:id/alunos inclui turma", () => {
  it("cada aluno traz turma e responsavel", async () => {
    const turma = (await req(admin, "POST", "/turmas", turmaBase)).json();
    const resp = await criarResponsavel(prisma, "b1");
    await criarAluno(prisma, { turmaId: turma.id, responsavelId: resp.id });

    const alunos = (await req(admin, "GET", `/turmas/${turma.id}/alunos`)).json();
    expect(alunos[0].turma.nome).toBe("6º Ano A");
    expect(alunos[0].responsavel.nome).toBe(resp.nome);
  });
});

describe("B2 · vínculo só com disciplina do currículo", () => {
  it("recusa disciplina fora do currículo; turma sem currículo aceita qualquer uma", async () => {
    const mat = await criarDisciplina(prisma, "Matemática");
    const artes = await criarDisciplina(prisma, "Artes");
    const comCurriculo = (await req(admin, "POST", "/turmas", { ...turmaBase, disciplinaIds: [mat.id] })).json();
    const semCurriculo = (await req(admin, "POST", "/turmas", { ...turmaBase, nome: "Sem" })).json();

    const fora = await req(admin, "POST", "/turma-disciplina-professor", { turmaId: comCurriculo.id, disciplinaId: artes.id, usuarioId: professorId });
    expect(fora.statusCode).toBe(400);
    expect(fora.json().message).toBe("A disciplina não faz parte do currículo da turma.");

    expect((await req(admin, "POST", "/turma-disciplina-professor", { turmaId: comCurriculo.id, disciplinaId: mat.id, usuarioId: professorId })).statusCode).toBe(201);
    expect((await req(admin, "POST", "/turma-disciplina-professor", { turmaId: semCurriculo.id, disciplinaId: artes.id, usuarioId: professorId })).statusCode).toBe(201);
  });

  it("tirar a disciplina do currículo remove os vínculos dela na turma", async () => {
    const mat = await criarDisciplina(prisma, "Matemática");
    const port = await criarDisciplina(prisma, "Português");
    const turma = (await req(admin, "POST", "/turmas", { ...turmaBase, disciplinaIds: [mat.id, port.id] })).json();
    await req(admin, "POST", "/turma-disciplina-professor", { turmaId: turma.id, disciplinaId: mat.id, usuarioId: professorId });
    await req(admin, "POST", "/turma-disciplina-professor", { turmaId: turma.id, disciplinaId: port.id, usuarioId: professorId });

    const editada = await req(admin, "PATCH", `/turmas/${turma.id}`, { disciplinaIds: [port.id] });
    expect(editada.statusCode).toBe(200);

    const vinculos = await prisma.turmaDisciplinaProfessor.findMany({ where: { turmaId: turma.id } });
    expect(vinculos.map((v) => v.disciplinaId)).toEqual([port.id]);
  });
});

describe("B3 · nome de disciplina único", () => {
  it("recusa nome repetido ignorando maiúsculas, acentos e espaços (POST e PATCH)", async () => {
    expect((await req(admin, "POST", "/disciplinas", { nome: "Matemática" })).statusCode).toBe(201);

    const repetida = await req(admin, "POST", "/disciplinas", { nome: "  MATEMATICA " });
    expect(repetida.statusCode).toBe(409);
    expect(repetida.json().message).toBe("Já existe uma disciplina com esse nome.");

    const outra = (await req(admin, "POST", "/disciplinas", { nome: "Física" })).json();
    expect((await req(admin, "PATCH", `/disciplinas/${outra.id}`, { nome: "matemática" })).statusCode).toBe(409);
    // Renomear a própria disciplina mudando só a caixa é permitido.
    expect((await req(admin, "PATCH", `/disciplinas/${outra.id}`, { nome: "FÍSICA" })).statusCode).toBe(200);
  });
});

describe("B4 · editar despesa e registro de funcionário", () => {
  it("PATCH /despesas/:id e /registros-funcionario/:id", async () => {
    const func = await prisma.funcionario.create({ data: { nome: "F", cargo: "X", cpf: "93541134780" } });
    const despesa = await prisma.despesa.create({
      data: { titulo: "Luz", categoria: "Utilidades", funcionarioId: func.id, formaPagamento: "PIX", valor: 4200, data: new Date("2026-11-01") },
    });
    const registro = await prisma.registroFuncionario.create({
      data: { funcionarioId: func.id, tipo: "VALE", descricao: "Adiantamento", valor: 200, data: new Date("2026-11-01") },
    });

    const d = await req(admin, "PATCH", `/despesas/${despesa.id}`, { valor: 4300 });
    expect(d.statusCode).toBe(200);
    expect(Number(d.json().valor)).toBe(4300);
    expect(d.json().titulo).toBe("Luz");

    const r = await req(admin, "PATCH", `/registros-funcionario/${registro.id}`, { descricao: null, valor: 250 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ descricao: null, tipo: "VALE" });

    expect((await req(admin, "PATCH", `/despesas/${despesa.id}`, { valor: -1 })).statusCode).toBe(400);
    expect((await req(admin, "PATCH", "/despesas/999999", { valor: 10 })).statusCode).toBe(404);
    expect((await req(professor, "PATCH", `/despesas/${despesa.id}`, { valor: 10 })).statusCode).toBe(403);
  });
});

describe("B5 · mensagem de duplicidade por recurso", () => {
  it("vínculo repetido com o mesmo professor", async () => {
    const mat = await criarDisciplina(prisma, "Matemática");
    const turma = (await req(admin, "POST", "/turmas", turmaBase)).json();
    const vinculo = { turmaId: turma.id, disciplinaId: mat.id, usuarioId: professorId };
    await req(admin, "POST", "/turma-disciplina-professor", vinculo);

    const repetido = await req(admin, "POST", "/turma-disciplina-professor", vinculo);
    expect(repetido.statusCode).toBe(409);
    expect(repetido.json().message).toBe("Esse professor já está vinculado a essa disciplina nessa turma.");
  });

  it("e-mail de usuário e mensalidade repetidos", async () => {
    const usuario = await req(admin, "POST", "/usuarios", { nome: "X", email: "prof@teste.com", senha: "123456", perfil: "professor" });
    expect(usuario.json().message).toBe("Já existe um usuário com esse e-mail.");

    const turma = (await req(admin, "POST", "/turmas", turmaBase)).json();
    const resp = await criarResponsavel(prisma, "b5");
    const aluno = await criarAluno(prisma, { turmaId: turma.id, responsavelId: resp.id });
    const m = { alunoId: aluno.id, mesReferencia: "2026-03", valor: 800, vencimento: "2026-03-05" };
    await req(admin, "POST", "/mensalidades", m);
    expect((await req(admin, "POST", "/mensalidades", m)).json().message).toBe("Já existe mensalidade desse aluno para esse mês.");
  });

  it("CPF repetido em responsável e funcionário", () => {
    expect(mensagemDuplicidade("/responsaveis", ["cpf"])).toBe("Já existe um cadastro com esse CPF.");
    expect(mensagemDuplicidade("/funcionarios/3", ["cpf"])).toBe("Já existe um cadastro com esse CPF.");
  });
});

describe("D1 · professor não recebe dados pessoais dos responsáveis", () => {
  it("GET /responsaveis e rotas com responsavel embutido", async () => {
    const turma = (await req(admin, "POST", "/turmas", turmaBase)).json();
    const resp = await criarResponsavel(prisma, "d1");
    const aluno = await criarAluno(prisma, { turmaId: turma.id, responsavelId: resp.id });

    const doProfessor = (await req(professor, "GET", "/responsaveis")).json()[0];
    expect(Object.keys(doProfessor).sort()).toEqual(["alunos", "id", "nome"]);
    expect(Object.keys((await req(professor, "GET", `/responsaveis/${resp.id}`)).json()).sort()).toEqual(["alunos", "id", "nome"]);

    for (const url of ["/alunos", `/alunos/${aluno.id}`, `/turmas/${turma.id}/alunos`]) {
      const corpo = (await req(professor, "GET", url)).json();
      const r = (Array.isArray(corpo) ? corpo[0] : corpo).responsavel;
      expect(r, url).toEqual({ id: resp.id, nome: resp.nome });
    }

    const doAdmin = (await req(admin, "GET", "/responsaveis")).json()[0];
    expect(doAdmin.cpf).toBe("11144477735");
    expect(doAdmin.telefone).toBeDefined();
  });
});

describe("Rotas financeiras e de RH só para admin", () => {
  it("professor recebe 403 em funcionários, despesas, registros e mensalidades; admin acessa", async () => {
    for (const url of ["/funcionarios", "/despesas", "/registros-funcionario", "/mensalidades"]) {
      expect((await req(professor, "GET", url)).statusCode, url).toBe(403);
      expect((await req(admin, "GET", url)).statusCode, url).toBe(200);
    }
  });
});
