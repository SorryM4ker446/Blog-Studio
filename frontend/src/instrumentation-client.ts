import { installEditorNavigation } from "./lib/editor-navigation";
import { installNavigationEntries } from "./lib/navigation-entry";

// Install before the router captures native history methods.
installEditorNavigation();
installNavigationEntries();
