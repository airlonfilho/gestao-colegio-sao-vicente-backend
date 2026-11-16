export function somenteDigitos(valor: string) {
  return valor.replace(/\D/g, "");
}

export function cpfValido(cpfComMascaraOuNao: string) {
  const cpf = somenteDigitos(cpfComMascaraOuNao);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calcularDigito = (fatorInicial: number, tamanho: number) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) {
      soma += Number(cpf[i]) * (fatorInicial - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const digito1 = calcularDigito(10, 9);
  const digito2 = calcularDigito(11, 10);

  return digito1 === Number(cpf[9]) && digito2 === Number(cpf[10]);
}

export function telefoneValido(telefone: string) {
  const digitos = somenteDigitos(telefone);
  return digitos.length === 10 || digitos.length === 11;
}
