import { installEditorNavigation } from "./lib/editor-navigation";

// Install before the router captures native history methods.
installEditorNavigation();
