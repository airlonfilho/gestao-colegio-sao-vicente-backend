import { buildApp } from "./app.js";
import { iniciarAgendador } from "./services/agendador.js";

const app = buildApp();

const port = Number(process.env.PORT ?? 3333);

app
  .listen({ host: "0.0.0.0", port })
  .then(() => iniciarAgendador(app))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
