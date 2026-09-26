import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Kunci penanda mode persistensi. Disimpan di `localStorage` selalu, karena
 * yang harus bertahan melewati restart browser hanyalah keputusan ini —
 * bukan session-nya.
 */
const PERSIST_KEY = "sb-persist-session";

/** Awalan kunci yang dipakai supabase-js untuk menyimpan session. */
const AUTH_KEY_PREFIX = "sb-";

/**
 * `auth.storage` hanya butuh tiga method, jadi adapter di bawah cukup memakai
 * `getItem` / `setItem` / `removeItem` sinkron — tidak perlu promisify.
 * Tipenya dibiarkan di-infer supaya tidak mengimpor dari `@supabase/auth-js`,
 * yang hanya dependency transitif.
 */
const authStorage = {
  getItem: (key: string) =>
    shouldPersistSession()
      ? localStorage.getItem(key)
      : sessionStorage.getItem(key),
  setItem: (key: string, value: string) => {
    if (shouldPersistSession()) {
      localStorage.setItem(key, value);
    } else {
      sessionStorage.setItem(key, value);
    }
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

function shouldPersistSession(): boolean {
  return localStorage.getItem(PERSIST_KEY) !== "0";
}

function clearAuthKeys(storage: Storage) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    // `PERSIST_KEY` juga diawali `sb-`, jadi harus dikecualikan secara
    // eksplisit — kalau tidak, `setSessionPersistence(false)` akan menghapus
    // flag yang baru saja ia tulis dan mode persist tidak pernah berubah.
    if (key && key !== PERSIST_KEY && key.startsWith(AUTH_KEY_PREFIX)) {
      keys.push(key);
    }
  }
  keys.forEach((key) => storage.removeItem(key));
}

/**
 * Pilih media penyimpanan session sebelum memanggil `signInWithPassword`.
 *
 * `true`  -> `localStorage`, session bertahan setelah tab ditutup.
 * `false` -> `sessionStorage`, session hilang begitu tab ditutup.
 *
 * Sisa session di media yang ditinggalkan dibersihkan supaya tidak ada dua
 * session hidup bersamaan.
 */
export function setSessionPersistence(persist: boolean) {
  localStorage.setItem(PERSIST_KEY, persist ? "1" : "0");
  clearAuthKeys(persist ? sessionStorage : localStorage);
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Supabase belum dikonfigurasi. Isi VITE_SUPABASE_URL dan " +
      "VITE_SUPABASE_ANON_KEY di file .env.local, lalu restart dev server. " +
      "Nilainya ada di Supabase Dashboard -> Project Settings -> API.",
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: authStorage,
    detectSessionInUrl: true,
    flowType: "implicit",
  },
});
