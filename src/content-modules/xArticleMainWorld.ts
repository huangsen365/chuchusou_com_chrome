// X Articles must receive this bridge in Chrome's MAIN world. The manifest
// therefore loads the audited classic-script implementation directly instead
// of bundling it into the isolated content-script world.
import "../../modules/xArticleMainWorld.js"

export {}
