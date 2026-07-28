/** @jsxImportSource @emotion/react */
import React, { useCallback, useEffect, useState } from "react";
import { useTheme } from "@mui/material/styles";
import PersonIcon from "@mui/icons-material/Person";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import InstagramIcon from "@mui/icons-material/Instagram";
import YouTubeIcon from "@mui/icons-material/YouTube";
import PinterestIcon from "@mui/icons-material/Pinterest";
import {
  Text,
  EditorButton,
  FlexColumn,
  FlexRow,
  Box,
  LoadingSpinner,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextInput,
  SPACING,
  BORDER_RADIUS
} from "../ui_primitives";
import { usePersonaStore, type Persona, type PlatformAccounts } from "../../stores/PersonaStore";

/** TikTok icon — not in MUI icons. */
const TikTokIcon: React.FC<{ fontSize?: "small" | "medium" | "inherit" }> = ({
  fontSize = "small"
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    width={fontSize === "small" ? 20 : 24}
    height={fontSize === "small" ? 20 : 24}
  >
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
  </svg>
);

/** Count how many platform accounts are bound. */
const countPlatforms = (accounts: PlatformAccounts): number => {
  let count = 0;
  if (accounts.instagram) count++;
  if (accounts.tiktok) count++;
  if (accounts.youtube) count++;
  if (accounts.pinterest) count++;
  return count;
};

/** Get initials from a name for the avatar fallback. */
const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

interface PersonaCardProps {
  persona: Persona;
  onEdit: (persona: Persona) => void;
  onDelete: (persona: Persona) => void;
}

const PersonaCard: React.FC<PersonaCardProps> = ({ persona, onEdit, onDelete }) => {
  const theme = useTheme();
  const platformCount = countPlatforms(persona.platformAccounts);

  return (
    <FlexRow
      align="center"
      gap={2}
      sx={{
        padding: theme.spacing(SPACING.lg),
        backgroundColor: theme.vars.palette.background.paper,
        borderRadius: BORDER_RADIUS.md,
        border: `1px solid ${theme.vars.palette.divider}`
      }}
    >
      {/* Avatar */}
      <Box
        sx={{
          width: 48,
          height: 48,
          borderRadius: BORDER_RADIUS.circle,
          backgroundColor: theme.vars.palette.action.hover,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          flexShrink: 0
        }}
      >
        {persona.avatarUrl ? (
          <img
            src={persona.avatarUrl}
            alt={persona.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <Text
            size="big"
            sx={{
              fontWeight: 600,
              color: theme.vars.palette.text.secondary
            }}
          >
            {getInitials(persona.name)}
          </Text>
        )}
      </Box>

      {/* Info */}
      <FlexColumn gap={0.5} sx={{ flex: 1, minWidth: 0 }}>
        <Text
          sx={{
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {persona.name}
        </Text>
        <FlexRow gap={1} align="center">
          {platformCount > 0 ? (
            <>
              {persona.platformAccounts.instagram && (
                <InstagramIcon
                  fontSize="small"
                  sx={{ color: theme.vars.palette.text.secondary }}
                />
              )}
              {persona.platformAccounts.tiktok && (
                <Box sx={{ color: theme.vars.palette.text.secondary }}>
                  <TikTokIcon fontSize="small" />
                </Box>
              )}
              {persona.platformAccounts.youtube && (
                <YouTubeIcon
                  fontSize="small"
                  sx={{ color: theme.vars.palette.text.secondary }}
                />
              )}
              {persona.platformAccounts.pinterest && (
                <PinterestIcon
                  fontSize="small"
                  sx={{ color: theme.vars.palette.text.secondary }}
                />
              )}
              <Text
                size="small"
                sx={{ color: theme.vars.palette.text.secondary }}
              >
                {platformCount} platform{platformCount !== 1 ? "s" : ""} connected
              </Text>
            </>
          ) : (
            <Text
              size="small"
              sx={{ color: theme.vars.palette.text.secondary }}
            >
              No platforms connected
            </Text>
          )}
        </FlexRow>
      </FlexColumn>

      {/* Actions */}
      <FlexRow gap={1}>
        <EditorButton
          variant="outlined"
          size="small"
          startIcon={<EditIcon />}
          onClick={() => onEdit(persona)}
        >
          Edit
        </EditorButton>
        <EditorButton
          variant="outlined"
          size="small"
          color="error"
          startIcon={<DeleteOutlineIcon />}
          onClick={() => onDelete(persona)}
        >
          Delete
        </EditorButton>
      </FlexRow>
    </FlexRow>
  );
};

interface PersonaFormDialogProps {
  open: boolean;
  persona: Persona | null;
  onClose: () => void;
  onSave: (data: {
    name: string;
    platformAccounts: PlatformAccounts;
  }) => Promise<void>;
}

const PersonaFormDialog: React.FC<PersonaFormDialogProps> = ({
  open,
  persona,
  onClose,
  onSave
}) => {
  const [name, setName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [tiktok, setTiktok] = useState("");
  const [youtube, setYoutube] = useState("");
  const [pinterest, setPinterest] = useState("");
  const [pinterestBoardId, setPinterestBoardId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (persona) {
        setName(persona.name);
        setInstagram(persona.platformAccounts.instagram ?? "");
        setTiktok(persona.platformAccounts.tiktok ?? "");
        setYoutube(persona.platformAccounts.youtube ?? "");
        setPinterest(persona.platformAccounts.pinterest ?? "");
        setPinterestBoardId(persona.platformAccounts.pinterestBoardId ?? "");
      } else {
        setName("");
        setInstagram("");
        setTiktok("");
        setYoutube("");
        setPinterest("");
        setPinterestBoardId("");
      }
    }
  }, [open, persona]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        platformAccounts: {
          ...(instagram.trim() ? { instagram: instagram.trim() } : {}),
          ...(tiktok.trim() ? { tiktok: tiktok.trim() } : {}),
          ...(youtube.trim() ? { youtube: youtube.trim() } : {}),
          ...(pinterest.trim() ? { pinterest: pinterest.trim() } : {}),
          ...(pinterestBoardId.trim()
            ? { pinterestBoardId: pinterestBoardId.trim() }
            : {})
        }
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{persona ? "Edit Persona" : "Create Persona"}</DialogTitle>
      <DialogContent>
        <FlexColumn gap={2} sx={{ paddingTop: 1 }}>
          <TextInput
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
            autoComplete="off"
          />

          <Text size="big" sx={{ marginTop: 2, marginBottom: 1 }}>
            Platform Accounts
          </Text>
          <Text className="description" sx={{ marginBottom: 1 }}>
            Enter your Zernio account IDs for each platform you want to publish
            to with this persona.
          </Text>

          <TextInput
            label="Instagram Account ID"
            value={instagram}
            onChange={(e) => setInstagram(e.target.value)}
            autoComplete="off"
            placeholder="e.g., acc_instagram_12345"
          />
          <TextInput
            label="TikTok Account ID"
            value={tiktok}
            onChange={(e) => setTiktok(e.target.value)}
            autoComplete="off"
            placeholder="e.g., acc_tiktok_12345"
          />
          <TextInput
            label="YouTube Account ID"
            value={youtube}
            onChange={(e) => setYoutube(e.target.value)}
            autoComplete="off"
            placeholder="e.g., acc_youtube_12345"
          />
          <TextInput
            label="Pinterest Account ID"
            value={pinterest}
            onChange={(e) => setPinterest(e.target.value)}
            autoComplete="off"
            placeholder="e.g., acc_pinterest_12345"
          />
          {pinterest.trim() && (
            <TextInput
              label="Pinterest Board ID"
              value={pinterestBoardId}
              onChange={(e) => setPinterestBoardId(e.target.value)}
              autoComplete="off"
              placeholder="e.g., board_12345"
            />
          )}
        </FlexColumn>
      </DialogContent>
      <DialogActions>
        <EditorButton variant="outlined" onClick={onClose} disabled={saving}>
          Cancel
        </EditorButton>
        <EditorButton
          variant="contained"
          onClick={handleSubmit}
          disabled={saving || !name.trim()}
        >
          {saving ? "Saving..." : persona ? "Save Changes" : "Create Persona"}
        </EditorButton>
      </DialogActions>
    </Dialog>
  );
};

interface DeleteConfirmDialogProps {
  open: boolean;
  personaName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}

const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  open,
  personaName,
  onConfirm,
  onCancel,
  isDeleting
}) => {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>Delete Persona</DialogTitle>
      <DialogContent>
        <Text>
          Are you sure you want to delete the persona{" "}
          <strong>{personaName}</strong>?
        </Text>
        <Text
          className="description"
          sx={{ marginTop: 1 }}
        >
          Workflows using this persona may stop working correctly.
        </Text>
      </DialogContent>
      <DialogActions>
        <EditorButton variant="outlined" onClick={onCancel} disabled={isDeleting}>
          Cancel
        </EditorButton>
        <EditorButton
          variant="contained"
          color="error"
          onClick={onConfirm}
          disabled={isDeleting}
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </EditorButton>
      </DialogActions>
    </Dialog>
  );
};

/**
 * Personas settings section for the Integrations tab.
 *
 * Lists personas as cards with avatar, name, and platform badge counts.
 * Provides create/edit/delete functionality.
 */
const PersonasSettings: React.FC = () => {
  const theme = useTheme();
  const {
    personas,
    isLoading,
    error,
    deleteTarget,
    deletingPersona,
    fetchPersonas,
    createPersona,
    updatePersona,
    setDeleteTarget,
    confirmDelete,
    cancelDelete
  } = usePersonaStore();

  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  useEffect(() => {
    fetchPersonas();
  }, [fetchPersonas]);

  const handleEdit = useCallback((persona: Persona) => {
    setEditingPersona(persona);
  }, []);

  const handleDelete = useCallback(
    (persona: Persona) => {
      setDeleteTarget(persona.id);
    },
    [setDeleteTarget]
  );

  const handleCreateSave = useCallback(
    async (data: { name: string; platformAccounts: PlatformAccounts }) => {
      await createPersona(data);
    },
    [createPersona]
  );

  const handleEditSave = useCallback(
    async (data: { name: string; platformAccounts: PlatformAccounts }) => {
      if (!editingPersona) return;
      await updatePersona(editingPersona.id, data);
    },
    [editingPersona, updatePersona]
  );

  const deleteTargetPersona = personas.find((p) => p.id === deleteTarget);

  return (
    <div className="settings-section">
      <Text size="big" id="personas" className="settings-heading">
        Personas
      </Text>
      <Text className="description" sx={{ marginBottom: 2 }}>
        Manage publishing identities for social media workflows. Each persona
        stores platform account bindings that can be selected in Zernio
        publishing nodes.
      </Text>

      {isLoading && personas.length === 0 ? (
        <FlexRow align="center" gap={1} sx={{ padding: 2 }}>
          <LoadingSpinner size="small" inline />
          <Text>Loading personas...</Text>
        </FlexRow>
      ) : error ? (
        <Text color="error" sx={{ padding: 2 }}>
          {error}
        </Text>
      ) : personas.length === 0 ? (
        <FlexColumn
          align="center"
          gap={2}
          sx={{
            padding: theme.spacing(SPACING.xxl),
            backgroundColor: theme.vars.palette.background.paper,
            borderRadius: BORDER_RADIUS.md,
            border: `1px dashed ${theme.vars.palette.divider}`
          }}
        >
          <PersonIcon
            sx={{
              fontSize: 48,
              color: theme.vars.palette.text.secondary,
              opacity: 0.5
            }}
          />
          <Text sx={{ color: theme.vars.palette.text.secondary }}>
            No personas yet
          </Text>
          <EditorButton
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowCreateDialog(true)}
          >
            Create Your First Persona
          </EditorButton>
        </FlexColumn>
      ) : (
        <FlexColumn gap={1.5}>
          {personas.map((persona) => (
            <PersonaCard
              key={persona.id}
              persona={persona}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
          <EditorButton
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => setShowCreateDialog(true)}
            sx={{ alignSelf: "flex-start", marginTop: 1 }}
          >
            Add Persona
          </EditorButton>
        </FlexColumn>
      )}

      {/* Create Dialog */}
      <PersonaFormDialog
        open={showCreateDialog}
        persona={null}
        onClose={() => setShowCreateDialog(false)}
        onSave={handleCreateSave}
      />

      {/* Edit Dialog */}
      <PersonaFormDialog
        open={editingPersona !== null}
        persona={editingPersona}
        onClose={() => setEditingPersona(null)}
        onSave={handleEditSave}
      />

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        personaName={deleteTargetPersona?.name ?? ""}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        isDeleting={deletingPersona !== null}
      />
    </div>
  );
};

export default PersonasSettings;
