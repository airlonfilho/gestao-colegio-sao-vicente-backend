import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { limparBanco } from "./helpers/db.js";
import { criarUsuario, logar, criarTurma, criarResponsavel, criarAluno } from "./helpers/fixtures.js";

const prisma = new PrismaClient();
const app = buildApp();

beforeEach(async () => {
  await limparBanco(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /mensalidades", () => {
  it("marca automaticamente como ATRASADO uma mensalidade PENDENTE vencida", async () => {
    await criarUsuario(prisma, { email: "admin@teste.com", senha: "123456", perfil: "admin" });
    const token = await logar(app, "admin@teste.com");
    const turma = await criarTurma(prisma);
    const responsavel = await criarResponsavel(prisma, "m1");
    const aluno = await criarAluno(prisma, { turmaId: turma.id, responsavelId: responsavel.id });

    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);

    await prisma.mensalidade.create({
      data: { alunoId: aluno.id, mesReferencia: "2026-01", valor: 1000, valorOriginal: 1000, vencimento: ontem, status: "PENDENTE" },
    });

    const resposta = await app.inject({ method: "GET", url: "/mensalidades", headers: { authorization: `Bearer ${token}` } });
    const mensalidades = JSON.parse(resposta.body);

    expect(mensalidades).toHaveLength(1);
    expect(mensalidades[0].status).toBe("ATRASADO");
  });

  it("não mexe em mensalidade PENDENTE que ainda não venceu", async () => {
    await criarUsuario(prisma, { email: "admin2@teste.com", senha: "123456", perfil: "admin" });
    const token = await logar(app, "admin2@teste.com");
    const turma = await criarTurma(prisma);
    const responsavel = await criarResponsavel(prisma, "m2");
    const aluno = await criarAluno(prisma, { turmaId: turma.id, responsavelId: responsavel.id });

    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);

    await prisma.mensalidade.create({
      data: { alunoId: aluno.id, mesReferencia: "2026-01", valor: 1000, valorOriginal: 1000, vencimento: amanha, status: "PENDENTE" },
    });

    const resposta = await app.inject({ method: "GET", url: "/mensalidades", headers: { authorization: `Bearer ${token}` } });
    expect(JSON.parse(resposta.body)[0].status).toBe("PENDENTE");
  });

  it("marcar como paga muda o status para PAGO mesmo se estava ATRASADO", async () => {
    await criarUsuario(prisma, { email: "admin3@teste.com", senha: "123456", perfil: "admin" });
    const token = await logar(app, "admin3@teste.com");
    const turma = await criarTurma(prisma);
    const responsavel = await criarResponsavel(prisma, "m3");
    const aluno = await criarAluno(prisma, { turmaId: turma.id, responsavelId: responsavel.id });

    const ontem = new Date();
    ontem.setDate(ontem.getDate() - 1);
    const mensalidade = await prisma.mensalidade.create({
      data: { alunoId: aluno.id, mesReferencia: "2026-01", valor: 1000, valorOriginal: 1000, vencimento: ontem, status: "PENDENTE" },
    });

    const resposta = await app.inject({
      method: "PATCH",
      url: `/mensalidades/${mensalidade.id}/pagamento`,
      headers: { authorization: `Bearer ${token}` },
      payload: { formaPagamento: "PIX" },
    });

    expect(resposta.statusCode).toBe(200);
    expect(JSON.parse(resposta.body).status).toBe("PAGO");
  });
});
