import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { limparBanco } from "./helpers/db.js";
import { criarUsuario } from "./helpers/fixtures.js";

const prisma = new PrismaClient();
const app = buildApp();

beforeEach(async () => {
  await limparBanco(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("POST /auth/login", () => {
  it("autentica com credenciais válidas e retorna token + usuário", async () => {
    await criarUsuario(prisma, { email: "admin@teste.com", senha: "123456", perfil: "admin" });

    const resposta = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin@teste.com", senha: "123456" },
    });

    expect(resposta.statusCode).toBe(200);
    const corpo = JSON.parse(resposta.body);
    expect(corpo.token).toBeTypeOf("string");
    expect(corpo.usuario.email).toBe("admin@teste.com");
    expect(corpo.usuario.senhaHash).toBeUndefined();
  });

  it("rejeita senha errada com 401", async () => {
    await criarUsuario(prisma, { email: "admin@teste.com", senha: "123456", perfil: "admin" });

    const resposta = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin@teste.com", senha: "senha-errada" },
    });

    expect(resposta.statusCode).toBe(401);
  });

  it("rejeita usuário inativo mesmo com senha certa", async () => {
    const usuario = await criarUsuario(prisma, { email: "inativo@teste.com", senha: "123456", perfil: "admin" });
    await prisma.usuario.update({ where: { id: usuario.id }, data: { ativo: false } });

    const resposta = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "inativo@teste.com", senha: "123456" },
    });

    expect(resposta.statusCode).toBe(401);
  });
});

describe("GET /alunos sem token", () => {
  it("retorna 401", async () => {
    const resposta = await app.inject({ method: "GET", url: "/alunos" });
    expect(resposta.statusCode).toBe(401);
  });
});
