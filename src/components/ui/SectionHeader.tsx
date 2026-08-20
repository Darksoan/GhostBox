import type { ReactNode } from "react";

type SectionHeaderProps = {
  title: string;
  /**
   * Conteúdo rico do heading (ex.: ícone + nome do jogo em "Porque você jogou").
   * `title` continua obrigatório: é ele que vai para o `aria-label` da seção.
   */
  titleContent?: ReactNode;
  subtitle?: string;
  action?: ReactNode;
};

export function SectionHeader({
  title,
  titleContent,
  subtitle,
  action,
}: SectionHeaderProps) {
  return (
    <div className="section-header">
      <div className="section-header__copy">
        <h2 className="section-header__title">{titleContent ?? title}</h2>
        {subtitle ? <p className="section-header__subtitle">{subtitle}</p> : null}
      </div>
      {action ? <div className="section-header__action">{action}</div> : null}
    </div>
  );
}
