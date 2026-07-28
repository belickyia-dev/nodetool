import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { trpcClient } from "../trpc/client";
import { queryClient } from "../queryClient";
import { useNotificationStore } from "./NotificationStore";

export interface PlatformAccounts {
  instagram?: string;
  tiktok?: string;
  youtube?: string;
  pinterest?: string;
  pinterestBoardId?: string;
}

export interface Persona {
  id: string;
  userId: string;
  name: string;
  avatarAssetId: string | null;
  avatarUrl: string | null;
  platformAccounts: PlatformAccounts;
  createdAt: string;
  updatedAt: string;
}

interface PersonaStore {
  personas: Persona[];
  isLoading: boolean;
  error: string | null;
  deleteTarget: string | null;
  deletingPersona: string | null;

  setPersonas: (personas: Persona[]) => void;
  setIsLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  setDeleteTarget: (target: string | null) => void;

  fetchPersonas: () => Promise<void>;
  createPersona: (input: {
    name: string;
    avatarAssetId?: string | null;
    platformAccounts?: PlatformAccounts;
  }) => Promise<Persona>;
  updatePersona: (
    id: string,
    input: {
      name?: string;
      avatarAssetId?: string | null;
      platformAccounts?: PlatformAccounts;
    }
  ) => Promise<Persona>;
  deletePersona: (id: string) => Promise<void>;
  confirmDelete: () => Promise<void>;
  cancelDelete: () => void;
}

export const usePersonaStore = create<PersonaStore>()(
  devtools(
    (set, get) => ({
      personas: [],
      isLoading: false,
      error: null,
      deleteTarget: null,
      deletingPersona: null,

      setPersonas: (personas) => set({ personas }),
      setIsLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setDeleteTarget: (target) => set({ deleteTarget: target }),

      fetchPersonas: async () => {
        set({ isLoading: true, error: null });
        try {
          const data = await trpcClient.personas.list.query({});
          set({
            personas: data.personas as Persona[],
            isLoading: false
          });
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : "Error loading personas",
            isLoading: false
          });
        }
      },

      createPersona: async (input) => {
        const persona = await trpcClient.personas.create.mutate(input);
        await get().fetchPersonas();
        queryClient.invalidateQueries({ queryKey: ["personas"] });
        return persona as Persona;
      },

      updatePersona: async (id, input) => {
        const persona = await trpcClient.personas.update.mutate({ id, ...input });
        await get().fetchPersonas();
        queryClient.invalidateQueries({ queryKey: ["personas"] });
        return persona as Persona;
      },

      deletePersona: async (id) => {
        await trpcClient.personas.delete.mutate({ id });
        await get().fetchPersonas();
        queryClient.invalidateQueries({ queryKey: ["personas"] });
      },

      confirmDelete: async () => {
        const deleteTarget = get().deleteTarget;
        if (!deleteTarget) {
          return;
        }
        const addNotification = useNotificationStore.getState().addNotification;
        const persona = get().personas.find((p) => p.id === deleteTarget);
        const personaName = persona?.name ?? "Persona";

        set({ deletingPersona: deleteTarget });
        try {
          await get().deletePersona(deleteTarget);
          set({ deleteTarget: null });
          addNotification({
            type: "success",
            alert: true,
            content: `Deleted persona "${personaName}"`
          });
        } catch (err) {
          addNotification({
            type: "error",
            alert: true,
            content: `Could not delete persona "${personaName}": ${
              err instanceof Error ? err.message : "unknown error"
            }`
          });
        } finally {
          set({ deletingPersona: null });
        }
      },

      cancelDelete: () => {
        set({ deleteTarget: null });
      }
    }),
    {
      name: "persona-store"
    }
  )
);
