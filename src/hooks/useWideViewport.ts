import { useEffect, useState } from "react";

/**
 * Largura a partir da qual a navegação vira card flutuante. Não depende do
 * estado de maximização: uma janela restaurada grande também passa do limite,
 * e uma janela maximizada num monitor pequeno continua com a sidebar.
 */
export const floatingNavMinWidth = 1600;

/**
 * Folga de histerese. Trocar sidebar por card flutuante desmonta uma árvore e
 * monta outra; com um limite único, parar o arrasto em cima dos 1600px fazia a
 * troca ir e voltar a cada frame (a própria sidebar sumindo devolve largura ao
 * conteúdo, que reavalia). Entrar em 1600 e só sair abaixo de 1560 dá a banda
 * morta que impede o pisca-pisca.
 */
const hysteresisPx = 40;

export function useWideViewport(minWidth = floatingNavMinWidth): boolean {
  const enterQuery = `(min-width: ${minWidth}px)`;
  const exitQuery = `(min-width: ${minWidth - hysteresisPx}px)`;

  const [isWide, setIsWide] = useState(
    () => window.matchMedia?.(enterQuery)?.matches ?? false
  );

  useEffect(() => {
    if (!window.matchMedia) return;

    const enterMedia = window.matchMedia(enterQuery);
    const exitMedia = window.matchMedia(exitQuery);

    // Já larga: só volta pra sidebar quando cair abaixo do limite menos a folga.
    // Estreita: só vira card flutuante ao cruzar o limite cheio.
    const update = () =>
      setIsWide((wide) => (wide ? exitMedia.matches : enterMedia.matches));

    update();
    enterMedia.addEventListener("change", update);
    exitMedia.addEventListener("change", update);

    return () => {
      enterMedia.removeEventListener("change", update);
      exitMedia.removeEventListener("change", update);
    };
  }, [enterQuery, exitQuery]);

  return isWide;
}
