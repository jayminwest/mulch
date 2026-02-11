export {
  getMulchDir,
  getConfigPath,
  getExpertiseDir,
  getExpertisePath,
  readConfig,
  writeConfig,
  initMulchDir,
} from "./config.js";

export {
  readExpertiseFile,
  appendRecord,
  createExpertiseFile,
  getFileModTime,
  countRecords,
  filterByType,
  generateRecordId,
} from "./expertise.js";

export {
  formatDomainExpertise,
  formatPrimeOutput,
  formatStatusOutput,
  formatTimeAgo,
  getRecordSummary,
} from "./format.js";

export {
  outputJson,
  outputJsonError,
} from "./json-output.js";

export {
  isGitRepo,
  getChangedFiles,
  fileMatchesAny,
  filterByContext,
} from "./git.js";

export {
  MARKER_START,
  MARKER_END,
  hasMarkerSection,
  replaceMarkerSection,
  removeMarkerSection,
  wrapInMarkers,
} from "./markers.js";

export {
  getCurrentVersion,
  getLatestVersion,
  compareSemver,
} from "./version.js";
