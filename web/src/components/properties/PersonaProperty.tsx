/** @jsxImportSource @emotion/react */
import React, { memo, useCallback, useEffect, useMemo } from "react";
import { css } from "@emotion/react";
import { useTheme } from "@mui/material/styles";
import PersonIcon from "@mui/icons-material/Person";
import { PropertyProps } from "../node/PropertyInput.types";
import isEqual from "../../utils/isEqual";
import PropertyLabel from "../node/PropertyLabel";
import Select from "../inputs/Select";
import { usePersonaStore, type Persona } from "../../stores/PersonaStore";
import { FlexRow, FlexColumn, Text, SPACING, BORDER_RADIUS } from "../ui_primitives";

/**
 * PersonaProperty renders a dropdown selector for choosing a persona.
 * When a persona is selected, shows which platforms are bound to it.
 */
const PersonaProperty: React.FC<PropertyProps<string>> = ({
  property,
  propertyIndex,
  value,
  onChange,
  tabIndex,
  changed
}) => {
  const theme = useTheme();
  const { personas, fetchPersonas, isLoading } = usePersonaStore();

  useEffect(() => {
    if (personas.length === 0 && !isLoading) {
      fetchPersonas();
    }
  }, [personas.length, isLoading, fetchPersonas]);

  const id = useMemo(
    () => `persona-${property.name}-${propertyIndex}`,
    [property.name, propertyIndex]
  );

  const options = useMemo(() => {
    const opts = [{ value: "", label: "None (manual input)" }];
    personas.forEach((persona) => {
      const platformCount = countPlatforms(persona);
      const label = platformCount > 0
        ? `${persona.name} (${platformCount} platform${platformCount !== 1 ? "s" : ""})`
        : persona.name;
      opts.push({ value: persona.id, label });
    });
    return opts;
  }, [personas]);

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === value) ?? null,
    [personas, value]
  );

  const handleChange = useCallback(
    (newValue: string) => {
      onChange(newValue);
    },
    [onChange]
  );

  const boundPlatforms = useMemo(() => {
    if (!selectedPersona) return [];
    const platforms: string[] = [];
    const accounts = selectedPersona.platformAccounts;
    if (accounts.instagram) platforms.push("Instagram");
    if (accounts.tiktok) platforms.push("TikTok");
    if (accounts.youtube) platforms.push("YouTube");
    if (accounts.pinterest) platforms.push("Pinterest");
    if (accounts.twitter) platforms.push("Twitter/X");
    if (accounts.facebook) platforms.push("Facebook");
    if (accounts.linkedin) platforms.push("LinkedIn");
    return platforms;
  }, [selectedPersona]);

  return (
    <div
      className="persona-property"
      css={css({
        width: "100%"
      })}
    >
      <PropertyLabel
        name={property.name}
        description={property.description}
        id={id}
      />
      <Select
        value={value || ""}
        onChange={handleChange}
        options={options}
        label={property.name}
        placeholder="Select persona..."
        tabIndex={tabIndex}
        changed={changed}
      />
      {selectedPersona && boundPlatforms.length > 0 && (
        <FlexRow
          align="center"
          gap={1}
          css={css({
            marginTop: theme.spacing(SPACING.sm),
            padding: theme.spacing(SPACING.sm),
            backgroundColor: theme.vars.palette.action.hover,
            borderRadius: BORDER_RADIUS.sm
          })}
        >
          <PersonIcon
            fontSize="small"
            css={css({ color: theme.vars.palette.text.secondary })}
          />
          <FlexColumn gap={0}>
            <Text
              size="small"
              css={css({
                fontWeight: 500,
                color: theme.vars.palette.text.primary
              })}
            >
              {selectedPersona.name}
            </Text>
            <Text
              size="small"
              css={css({ color: theme.vars.palette.text.secondary })}
            >
              {boundPlatforms.join(", ")}
            </Text>
          </FlexColumn>
        </FlexRow>
      )}
    </div>
  );
};

function countPlatforms(persona: Persona): number {
  let count = 0;
  const accounts = persona.platformAccounts;
  if (accounts.instagram) count++;
  if (accounts.tiktok) count++;
  if (accounts.youtube) count++;
  if (accounts.pinterest) count++;
  if (accounts.twitter) count++;
  if (accounts.facebook) count++;
  if (accounts.linkedin) count++;
  return count;
}

export default memo(PersonaProperty, isEqual);
