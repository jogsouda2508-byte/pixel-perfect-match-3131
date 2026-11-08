COMMUNITY FEATURE - how to apply
1. Unzip into the ROOT of your project (same folder structure). Replace when asked.
2. Run the SQL once: Supabase > SQL Editor > paste supabase/migrations/20261104000000_community.sql > Run.
   (safe to run again; it will not break anything)
3. Open the app > More > Community (also in the desktop side menu).

New files: src/lib/community.ts, src/routes/community.tsx, src/components/community/*, the migration.
Edited files: src/components/ediraa.tsx (side menu link), src/routes/more.tsx (More link), src/routeTree.gen.ts (new /community route).
