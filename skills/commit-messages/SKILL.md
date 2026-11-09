---
name: commit-messages
description: Redacta mensajes de commit claros a partir de los cambios del repositorio
---

# Mensajes de commit

1. Ejecuta `git status` y `git diff --staged` (si no hay nada preparado, `git diff`) para ver los cambios.
2. Escribe un título de máximo 72 caracteres, en imperativo y que diga qué cambia y para qué.
3. Si el cambio no es obvio, agrega un cuerpo separado por una línea en blanco que explique el porqué.
4. Muestra el mensaje al usuario antes de ejecutar `git commit`; no hagas push sin que lo pida.
