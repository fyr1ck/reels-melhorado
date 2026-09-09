import { useCallback, useEffect, useState } from 'react';

/**
 * Estado que sobrevive à troca de tela.
 *
 * `useState` some quando o componente desmonta, e trocar de seção no menu
 * desmonta a tela inteira. Escolhas que a pessoa fez de propósito — o modo de
 * distribuição, quais contas participam — voltavam ao padrão sozinhas, e o
 * sintoma era o painel "esquecendo" o que tinha acabado de ser configurado.
 *
 * O que MORA no servidor (ritmo, horários, limites) continua no servidor: isto
 * é só para preferência de interface, que não pertence a nenhuma conta.
 *
 * Toda leitura e escrita vai em try/catch: em janela anônima, ou com o
 * armazenamento bloqueado, o acesso lança — e uma preferência de interface não
 * pode derrubar a tela.
 */
export function usePreferencia(chave, inicial) {
  const [valor, setValor] = useState(() => {
    try {
      const bruto = localStorage.getItem(chave);
      return bruto === null ? inicial : JSON.parse(bruto);
    } catch {
      return inicial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
    } catch {
      /* sem armazenamento: a escolha vale só nesta visita */
    }
  }, [chave, valor]);

  return [valor, setValor];
}

/**
 * O mesmo, para um conjunto.
 *
 * `Set` não sobrevive a JSON.stringify — vira `{}` e a seleção se perde em
 * silêncio na primeira recarga. Aqui ele é guardado como lista e reconstruído
 * na leitura.
 */
export function useConjuntoPreferido(chave) {
  const [lista, setLista] = usePreferencia(chave, []);

  const conjunto = new Set(Array.isArray(lista) ? lista : []);

  const definir = useCallback((atualizar) => {
    setLista((atual) => {
      const antes = new Set(Array.isArray(atual) ? atual : []);
      const depois = typeof atualizar === 'function' ? atualizar(antes) : atualizar;
      return [...depois];
    });
  }, [setLista]);

  return [conjunto, definir];
}
