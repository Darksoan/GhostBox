-- Classificação do tipo de app Steam para excluir demos de todas as rotas.
-- Sem DEFAULT propositalmente: linhas legadas ficam NULL (= não classificadas)
-- e permanecem ocultas até o backfill. Apenas linhas classificadas e
-- diferentes de 'demo' são servidas.
ALTER TABLE games ADD COLUMN app_type TEXT;
