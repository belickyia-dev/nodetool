import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import mockTheme from "../../../__mocks__/themeMock";
import PersonaProperty from "../PersonaProperty";
import { usePersonaStore } from "../../../stores/PersonaStore";
import type { Persona } from "../../../stores/PersonaStore";

// Mock the PersonaStore
jest.mock("../../../stores/PersonaStore", () => ({
  usePersonaStore: jest.fn()
}));

const mockPersonas: Persona[] = [
  {
    id: "persona-1",
    userId: "user-1",
    name: "Brand Account",
    avatarAssetId: null,
    avatarUrl: null,
    platformAccounts: {
      instagram: "ig_brand",
      tiktok: "tt_brand",
      youtube: "yt_brand"
    },
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  },
  {
    id: "persona-2",
    userId: "user-1",
    name: "Personal",
    avatarAssetId: null,
    avatarUrl: null,
    platformAccounts: {
      instagram: "ig_personal"
    },
    createdAt: "2024-01-02T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z"
  }
];

const defaultProps = {
  property: {
    name: "personaId",
    type: { type: "string", optional: false, type_args: [] },
    description: "Select a persona",
    default: "",
    required: false
  },
  propertyIndex: "0",
  value: "",
  onChange: jest.fn(),
  tabIndex: 0,
  changed: false,
  isConnected: false,
  isReadOnly: false,
  nodeType: "nodetool.test.Node",
  nodeId: "test-node-1"
};

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={mockTheme}>{ui}</ThemeProvider>);
}

describe("PersonaProperty", () => {
  const mockFetchPersonas = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (usePersonaStore as unknown as jest.Mock).mockReturnValue({
      personas: mockPersonas,
      fetchPersonas: mockFetchPersonas,
      isLoading: false
    });
  });

  it("should render the persona selector", () => {
    renderWithTheme(<PersonaProperty {...defaultProps} />);

    // The component should render with the persona-property class
    expect(document.querySelector(".persona-property")).toBeInTheDocument();
  });

  it("should fetch personas on mount when list is empty", () => {
    (usePersonaStore as unknown as jest.Mock).mockReturnValue({
      personas: [],
      fetchPersonas: mockFetchPersonas,
      isLoading: false
    });

    renderWithTheme(<PersonaProperty {...defaultProps} />);

    expect(mockFetchPersonas).toHaveBeenCalled();
  });

  it("should not fetch personas when already loaded", () => {
    renderWithTheme(<PersonaProperty {...defaultProps} />);

    expect(mockFetchPersonas).not.toHaveBeenCalled();
  });

  it("should show platform info when persona is selected", () => {
    renderWithTheme(
      <PersonaProperty {...defaultProps} value="persona-1" />
    );

    expect(screen.getByText("Brand Account")).toBeInTheDocument();
    expect(screen.getByText("Instagram, TikTok, YouTube")).toBeInTheDocument();
  });

  it("should not show platform info when no persona selected", () => {
    renderWithTheme(<PersonaProperty {...defaultProps} value="" />);

    expect(screen.queryByText("Instagram, TikTok, YouTube")).not.toBeInTheDocument();
  });

  it("should handle all platform types", () => {
    const personaWithAllPlatforms: Persona = {
      id: "persona-all",
      userId: "user-1",
      name: "All Platforms",
      avatarAssetId: null,
      avatarUrl: null,
      platformAccounts: {
        instagram: "ig",
        tiktok: "tt",
        youtube: "yt",
        pinterest: "pin",
        twitter: "tw",
        facebook: "fb",
        linkedin: "li"
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z"
    };

    (usePersonaStore as unknown as jest.Mock).mockReturnValue({
      personas: [personaWithAllPlatforms],
      fetchPersonas: mockFetchPersonas,
      isLoading: false
    });

    renderWithTheme(
      <PersonaProperty {...defaultProps} value="persona-all" />
    );

    expect(
      screen.getByText("Instagram, TikTok, YouTube, Pinterest, Twitter/X, Facebook, LinkedIn")
    ).toBeInTheDocument();
  });
});
