import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { limparBanco } from "./helpers/db.js";
import { criarUsuario, logar } from "./helpers/fixtures.js";

const prisma = new PrismaClient();
const app = buildApp();

beforeEach(async () => {
  await limparBanco(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function tokenAdmin() {
  await criarUsuario(prisma, { email: "admin@teste.com", senha: "123456", perfil: "admin" });
  return logar(app, "admin@teste.com");
}

describe("Validação de CPF/telefone em /responsaveis", () => {
  it("rejeita CPF com dígito verificador inválido", async () => {
    const token = await tokenAdmin();

    const resposta = await app.inject({
      method: "POST",
      url: "/responsaveis",
      headers: { authorization: `Bearer ${token}` },
      payload: { nome: "Teste", cpf: "11111111111", telefone: "11999998888" },
    });

    expect(resposta.statusCode).toBe(400);
    expect(JSON.parse(resposta.body).fieldErrors.cpf).toBeDefined();
  });

  it("aceita CPF/telefone com máscara e normaliza para só dígitos ao salvar", async () => {
    const token = await tokenAdmin();

    const resposta = await app.inject({
      method: "POST",
      url: "/responsaveis",
      headers: { authorization: `Bearer ${token}` },
      payload: { nome: "José Teste", cpf: "111.444.777-35", telefone: "(11) 99999-8888" },
    });

    expect(resposta.statusCode).toBe(201);
    const corpo = JSON.parse(resposta.body);
    expect(corpo.cpf).toBe("11144477735");
    expect(corpo.telefone).toBe("11999998888");
  });
});

describe("Erro de duplicidade (Prisma P2002)", () => {
  it("email de usuário duplicado retorna 409 tratado, não 500 cru", async () => {
    const token = await tokenAdmin();

    const resposta = await app.inject({
      method: "POST",
      url: "/usuarios",
      headers: { authorization: `Bearer ${token}` },
      payload: { nome: "Duplicado", email: "admin@teste.com", senha: "123456", perfil: "admin" },
    });

    expect(resposta.statusCode).toBe(409);
    expect(JSON.parse(resposta.body).message).toBeTypeOf("string");
  });
});
