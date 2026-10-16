// Typed shapes of the JSON configs (源文档第 11 章 + game.json for global tunables).

export type Vec3Tuple = [number, number, number];
export type Vec2Tuple = [number, number];

export interface CharacterDef {
  id: string;
  displayName: string;
  role: 'gunner' | 'economy';
  tagline: string;
  maxHealth: number;
  damageMultiplier: number;
  moveSpeedMultiplier: number;
  passiveSunPerSecond: number;
  startingSun: number;
  startingItems: Record<string, number>;
  startingReserveAmmo: number;
  weapon: string | null;
  canBuyAmmo: boolean;
  availableSeeds: string[];
  blockedSeeds: string[];
  availablePotions: string[];
}

export interface GunDef {
  id: string;
  displayName: string;
  damage: number;
  headshotMultiplier: number;
  limbMultiplier: number;
  rpm: number;
  magazineSize: number;
  reserveAmmoMax: number;
  reloadTime: number;
  range: number;
  falloffMultiplier: number;
  baseSpreadDeg: number;
  maxSpreadDeg: number;
  recoilVerticalDeg: number;
  recoilHorizontalDeg: number;
  adsFov: number;
  adsMoveMultiplier: number;
  hipFov: number;
  spreadPerShotDeg: number;
  spreadMoveAddDeg: number;
  spreadAirAddDeg: number;
  adsSpreadMultiplier: number;
  spreadRecoverTime: number;
  recoilRecoverTime: number;
}

export interface AmmoPackDef {
  id: string;
  displayName: string;
  price: number;
  rounds: number;
  refillsReserveDirectly: boolean;
}

export interface WeaponsConfig {
  pea_gun: GunDef;
  ammo_pack: AmmoPackDef;
  [key: string]: GunDef | AmmoPackDef;
}

export interface ZombieTargetingDef {
  playerAlwaysFirst: boolean;
  breakWallWhenBlocked: boolean;
  plantShareKillRange: number;
  plantKillWhenPlayerUnreachableRange: number;
  sunflowerShareKillRange: number;
  deaggroWhenPlayerLost: { distance: number; seconds: number };
  reevaluateInterval: number;
}

export interface ZombieDef {
  id: string;
  displayName: string;
  health: number;
  wanderSpeed: number;
  chaseSpeed: number;
  attackDamage: number;
  attackDamageVsPlant: Record<string, number>;
  attackInterval: number;
  attackRange: number;
  attackWindup: number;
  attackRecover: number;
  visionRange: number;
  visionAngleDeg: number;
  hearingRange: number;
  hearingRadius: { gunshot: number; plantFire: number; running: number; playerHurt: number };
  sunDrop: number;
  headHeightRange: [number, number];
  legHeight: number;
  torsoHalfWidth: number;
  colliderRadius: number;
  colliderHeight: number;
  alertDuration: number;
  wanderRadius: number;
  hitReactDuration: number;
  hitReactMaxInterrupt: number;
  deathRemoveDelay: number;
  colliderDisableDelay: number;
  ambushTriggerRange: number;
  separationRadius: number;
  separationStrength: number;
  speedVariance: number;
  reactionVariance: number;
  stuckSeconds: number;
  breakCostMultiplier: number;
  lodMidDistance: number;
  lodFarDistance: number;
  lodMidHz: number;
  targeting: ZombieTargetingDef;
}

export type ZombiesConfig = Record<string, ZombieDef>;

export type PlantCategory = 'economy' | 'combat' | 'barrier' | 'temporary';

export interface PlantDef {
  id: string;
  seedItemId: string;
  displayName: string;
  category: PlantCategory;
  health: number;
  footprintRadius: number;
  maxAlive: number;
  onlyByCharacter: string | null;
  sunPerSecond?: number;
  sunTickInterval?: number;
  attackDamage?: number;
  attackInterval?: number;
  attackRange?: number;
  attackDropRange?: number;
  turnSpeedDegPerSec?: number;
  fireAngleToleranceDeg?: number;
  targetEvalInterval?: number;
  slowPercent?: number;
  slowDuration?: number;
  destroyedByShareKillRange?: number;
  isPhysicalBlocker?: boolean;
  fuseSeconds?: number;
  explosionRadius?: number;
  explosionDamageCenter?: number;
  explosionDamageEdge?: number;
  triggerRadius?: number;
  rootDuration?: number;
  oneShotPerZombie?: boolean;
  isTemporary?: boolean;
}

export interface PlantingRules {
  maxPlacementDistance: number;
  maxSlopeDeg: number;
  plantAnimationTime: number;
  shovelAnimationTime: number;
  refundPercentOnShovel: number;
}

export interface PlantsConfig {
  plants: Record<string, PlantDef>;
  plantingRules: PlantingRules;
}

export type ShopCategory = 'ammo' | 'potion' | 'seed' | 'consumable' | 'equipment';

export type ItemEffect =
  | { type: 'ice'; slowPercent: number; slowDuration: number }
  | { type: 'power'; damageMultiplier: number }
  | { type: 'heal'; amount: number; useTime: number }
  | { type: 'permanentDamage'; bonus: number }
  | { type: 'permanentSun'; bonus: number };

export interface ShopItem {
  id: string;
  category: ShopCategory;
  price: number;
  maxCarry: number | null;
  durationSeconds?: number;
  name: string;
  desc: string;
  availableTo: string[];
  enabled?: boolean;
  effect?: ItemEffect;
}

export interface ShopConfig {
  items: ShopItem[];
  rules: { potionStacking: 'replace'; ammoAppliesImmediately: boolean; newbieSafetyPricing: boolean };
}

export type DoorSide = 'north' | 'south' | 'east' | 'west';
export type RoomId = 'hall' | 'backLeft' | 'backRight' | 'upstairs' | 'upstairsBack';

export interface BuildingDef {
  id: string;
  name: string;
  district: string;
  center: Vec2Tuple;
  size: Vec2Tuple;
  height: number;
  enterable: boolean;
  doorSide?: DoorSide;
  color: string;
  landmark?: 'clock' | 'supermarket';
}

export interface PlaceRef {
  pos?: Vec3Tuple;
  building?: string;
  room?: RoomId;
}

export interface ZombieSpawnerDef extends PlaceRef {
  id: string;
  type: string;
  maxAlive: number;
  respawnCooldown: number;
  activationRadius: number;
  mode: 'outdoor' | 'indoor';
  patrolRoute?: string;
}

export interface AmbushPointDef extends PlaceRef {
  id: string;
  count: number;
  trigger: 'player_inside';
}

export interface PickupPointDef extends PlaceRef {
  id: string;
  item: string;
  respawn: number;
}

export interface PropDef {
  id: string;
  kind: 'container' | 'ramp' | 'barricade' | 'car' | 'trashbin' | 'lamp' | 'gas_station' | 'fountain';
  pos: Vec3Tuple;
  rotYDeg?: number;
  slopeDeg?: number;
  size?: Vec3Tuple;
}

export interface ZoneDef {
  id: string;
  type: string;
  points: Vec2Tuple[];
}

export interface RectDef {
  id: string;
  name: string;
  rect: [number, number, number, number];
}

export interface MapConfig {
  id: string;
  size: Vec2Tuple;
  boundaryWallHeight: number;
  districts: RectDef[];
  highValueAreas: RectDef[];
  roads: { halfWidth: number; centerNoPlantHalfWidth: number };
  playerSpawns: { id: string; pos: Vec3Tuple }[];
  trainingDummy: Vec3Tuple;
  buildings: BuildingDef[];
  props: PropDef[];
  zombieSpawners: ZombieSpawnerDef[];
  ambushPoints: AmbushPointDef[];
  patrolRoutes: { id: string; waypoints: Vec3Tuple[] }[];
  pickupPoints: PickupPointDef[];
  plantableZones: ZoneDef[];
  nonPlantableZones: ZoneDef[];
  waypointGraph: {
    grid: { spacing: number; min: Vec2Tuple; max: Vec2Tuple; clearance: number };
    doorLinkRadius: number;
    nodes: { id: string; pos: Vec3Tuple }[];
    edges: [string, string][];
  };
}

export interface QualityPreset {
  shadows: boolean;
  shadowMapSize: number;
  particleScale: number;
  pixelRatioCap: number;
  drawDistance: number;
}

export interface GameConfig {
  loop: { fixedDt: number; maxSubSteps: number };
  movement: {
    standEyeHeight: number;
    crouchEyeHeight: number;
    capsuleRadius: number;
    capsuleHeight: number;
    walkSpeed: number;
    sprintMultiplier: number;
    crouchMultiplier: number;
    jumpSpeed: number;
    gravity: number;
    airControl: number;
    stepHeight: number;
    maxClimbSlopeDeg: number;
    fallRescueY: number;
    bobAmplitude: number;
    bobFrequency: number;
    landingImpactScale: number;
    interactRange: number;
    sensitivityDefault: number;
    sensitivityMin: number;
    sensitivityMax: number;
  };
  health: {
    lowHealthThreshold: number;
    lowHealthMoveMultiplier: number;
    respawnDelay: number;
    invulnerableAfterRespawn: number;
    regenDelay: number;
    regenPerSecond: number;
    regenCapFraction: number;
  };
  economy: {
    sunCap: number;
    killReward: number;
    headshotBonus: number;
    passiveTickInterval: number;
    sunPackAmount: number;
    sunPackLifetime: number;
    sunPackPickupRadius: number;
  };
  inventory: { hotbarSlots: number };
  spawnDirector: {
    globalMaxAlive: number;
    pressureInterval: number;
    pressureRateStep: number;
    pressureCapStep: number;
    maxPressureLevel: number;
    minSpawnDistance: number;
    defenseThreshold: number;
    defenseRadius: number;
    defenseRateMultiplier: number;
    lingerSeconds: number;
    lingerRateMultiplier: number;
    evalInterval: number;
  };
  ui: { bannerDuration: number; ammoBannerCooldown: number; shopAnimTime: number; floatTextDuration: number };
  audio: { combatRadius: number; combatZombieCount: number; crossfadeTime: number; maxTotalMB: number };
  render: { quality: Record<'low' | 'medium' | 'high', QualityPreset> };
}

export interface AllConfig {
  characters: Record<string, CharacterDef>;
  weapons: WeaponsConfig;
  zombies: ZombiesConfig;
  plants: PlantsConfig;
  shop: ShopConfig;
  map: MapConfig;
  game: GameConfig;
}
