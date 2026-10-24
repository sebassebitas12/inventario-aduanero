# Inventario aduanero · Lab 3

Aplicación web con React + Vite + JavaScript, API Node.js + Express y PostgreSQL en Supabase. El asistente de consultas se integra con n8n.

## Datos

La aplicación consulta las trece tablas existentes en Supabase. El DER manual acordado tiene ocho entidades y se entrega por separado con los documentos académicos. Este repositorio no incluye migraciones para crear, borrar o renombrar tablas.

## Funciones

- Dashboard con indicadores de declaraciones, inventario, movimientos e inspecciones.
- Pantallas para consultar y administrar las trece tablas.
- Selectores para seguir las relaciones entre registros.
- Chat integrado con el agente de n8n.

## Desarrollo local

Requiere Node.js y una base PostgreSQL de Supabase. En PowerShell, configura los archivos de entorno desde sus ejemplos:

    cd backend
    npm.cmd install
    Copy-Item .env.example .env
    npm.cmd run dev

En otra terminal:

    cd frontend
    npm.cmd install
    Copy-Item .env.example .env
    npm.cmd run dev

La API usa http://localhost:4000 y Vite http://localhost:5173. Completa backend/.env con DATABASE_URL y la URL del webhook n8n. No subas los valores reales de .env.

## n8n

El workflow está en n8n/Agente_Consulta_Aduanera.json. Para usarlo en otra instancia, importa el JSON, configura tus credenciales de DeepSeek y PostgreSQL, publica el workflow y agrega su URL de producción a backend/.env. La cuenta de PostgreSQL del agente debe limitarse a lectura. Consulta n8n/README.md para más detalles.

## Seguridad

- La API está pensada para desarrollo local y no implementa autenticación.
- El usuario de n8n debe tener permisos de solo lectura.
- Los archivos .env están excluidos de Git; solo se incluyen ejemplos con marcadores.

Los documentos académicos, incluido el DER, se entregan como adjuntos separados en Classroom.
