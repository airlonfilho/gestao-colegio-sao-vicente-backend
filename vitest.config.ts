import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    // Todos os testes compartilham um único banco de teste — roda tudo num fork
    // só, em sequência, para não ter corrida entre arquivos mexendo nas mesmas tabelas.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 30000,
    testTimeout: 15000,
  },
});
