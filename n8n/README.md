# Integrar el asistente con n8n

El workflow del proyecto es Agente_Consulta_Aduanera.json. Usa Chat Trigger, AI Agent, un modelo DeepSeek, memoria simple y Postgres Tool. El JSON no incluye contraseñas ni claves de API.

## Configuración en una instancia nueva

1. Importa Agente_Consulta_Aduanera.json en n8n.
2. En DeepSeek Chat Model, selecciona tu credencial de DeepSeek.
3. En Postgres Tool, crea o selecciona una credencial PostgreSQL de solo lectura para Supabase.
4. Publica el workflow y copia la URL de producción del nodo Chat Trigger.
5. Coloca esa URL en N8N_CHAT_WEBHOOK_URL dentro de backend/.env y reinicia la API.

La API reenvía el chat a n8n. El navegador se comunica únicamente con la API, por lo que no necesita la URL del webhook ni las credenciales de PostgreSQL.

## Permisos de base de datos

El prompt restringe las consultas a SELECT, pero el prompt no es un control de permisos. Asigna al agente un rol PostgreSQL sin permisos de escritura y limita sus permisos a las tablas necesarias.
