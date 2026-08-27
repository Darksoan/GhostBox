import { shots, type ShotVariant } from "../content/shots.generated";
import type { Language } from "../content";
import { LauncherMockup } from "./LauncherMockup";
import "./AppShot.scss";

interface AppShotProps {
  variant: ShotVariant;
  label: string;
}

/** Idioma em que as capturas de `screenshots/` foram tiradas. */
const SHOT_LANGUAGE: Language = "en";

/**
 * Captura de tela real do launcher. Enquanto não existir arquivo para a
 * variante (`npm run site:shots`), cai no mockup em DOM — a página nunca fica
 * com um buraco no lugar da interface.
 */
export function AppShot({ variant, label }: AppShotProps) {
  const shot = shots[variant];
  // O mockup acompanha o idioma das capturas, não o do site: as duas coisas
  // aparecem lado a lado na mesma página, e uma janela em português ao lado de
  // uma em inglês denuncia na hora qual é desenhada.
  if (!shot) return <LauncherMockup variant={variant} label={label} language={SHOT_LANGUAGE} />;

  return (
    <figure className="shot">
      <img
        className="shot__image"
        src={shot.src}
        srcSet={`${shot.small} 720w, ${shot.src} 1440w`}
        sizes="(min-width: 960px) 60vw, 100vw"
        width={shot.width}
        height={shot.height}
        alt={label}
        loading="lazy"
        decoding="async"
      />
    </figure>
  );
}
