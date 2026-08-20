import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

type VendorNature = 'GOODS' | 'SERVICES' | 'RENT' | 'GOODS / SERVICES' | 'SERVICES/GOODS' | 'RENT / SERVICES';
type ImportBrandCategory = 'SPORTS' | 'FASHION' | 'WATCHES';

interface VendorSeed {
  code: string;
  name: string;
  brands?: string[];
  nature: VendorNature;
  address: string;
  contactNo?: string;
  cnic?: string;
  ntn?: string;
  strn?: string;
  srb?: string;
  pra?: string;
  ict?: string;
  accountCodes: string[];
}

function getAccountCodes(nature: VendorNature | string): string[] {
  switch (nature) {
    case 'GOODS':            return ['12010004'];
    case 'SERVICES':         return ['12030001'];
    case 'RENT':             return ['12030001'];
    case 'GOODS / SERVICES': return ['12010004', '12030001'];
    case 'SERVICES/GOODS':  return ['12010004', '12030001'];
    case 'RENT / SERVICES':  return ['12030001'];
    default:                 return ['12030001'];
  }
}

function getImportAccountCodes(category: ImportBrandCategory): string[] {
  switch (category) {
    case 'SPORTS':  return ['12010001'];
    case 'FASHION': return ['12010002'];
    case 'WATCHES': return ['12010003'];
  }
}

const rawLocalVendors: Array<Omit<VendorSeed, 'accountCodes'>> = [
  {
    "code": "120001",
    "name": "EFU GENERAL INSURANCE CO. LTD.",
    "nature": "SERVICES",
    "address": "EFU HOUSE, M.A JINNAH ROAD, KARACHI",
    "contactNo": "0300-8288838",
    "ntn": "0944893-4",
    "strn": "Registered",
    "srb": "S0944893-4",
    "pra": "P0944893-4"
  },
  {
    "code": "120002",
    "name": "KHAYABAN-E-IQBAL",
    "nature": "SERVICES",
    "address": "123-124 THE FORUM G-20 BLOCK-9 CLIFTON, KARACHI",
    "contactNo": "021-35831275",
    "ntn": "0816951-9",
    "strn": "1200842800864"
  },
  {
    "code": "120003",
    "name": "PTCL",
    "nature": "SERVICES",
    "address": "PTCL Head Office, Room# 17, Ground Floor (Margalla Side), Ufone Tower, Plot# 55-C, Main Jinnah Avenue, Sector F-7/1, Blue Area, Islamabad.",
    "contactNo": "0308 2894101",
    "ntn": "0801599-6",
    "strn": "0701851701346",
    "srb": "S0801599-6",
    "pra": "P0801599-6"
  },
  {
    "code": "120004",
    "name": "AL FEROZ (PVT) LTD.",
    "nature": "SERVICES",
    "address": "C-36-I, Defence Commercial Market D.H.A. Society Kyc, Karachi",
    "contactNo": "021-34534454",
    "ntn": "1019774-5",
    "strn": "Registered",
    "srb": "S1019774-5"
  },
  {
    "code": "120005",
    "name": "PAK MOBILE COMMUNICATION",
    "nature": "SERVICES",
    "address": "1-A, IBC BUILDING F-8 MARKAZ MOBILINK HOUSE Islamabad",
    "contactNo": "9221-5670267",
    "ntn": "0802694-7",
    "strn": "Registered",
    "srb": "S0802694-7",
    "pra": "P0802694-7"
  },
  {
    "code": "120006",
    "name": "NADEEM SHAHZAD",
    "nature": "SERVICES",
    "address": "94-C-2 Gulberg III,Lahore",
    "contactNo": "042-111786240",
    "cnic": "38403-2204729-1",
    "ntn": "1546691-4",
    "strn": "Registered"
  },
  {
    "code": "120007",
    "name": "VISAGE",
    "nature": "SERVICES",
    "address": "16 MALL SQUARE ZAMZAM BLOCK V ARD P-5DHA ,KARACHI",
    "contactNo": "021-35861787",
    "cnic": "42301-9850791-6",
    "ntn": "0292227-4"
  },
  {
    "code": "120008",
    "name": "AL NASIR TRANSPORT SERVICE",
    "nature": "SERVICES",
    "address": "X-394, STREET NO 9, HILL AREA, CHANESAR GOTH, MEHMOOD ABAD, KARACHI, Karachi East Jamshed Town",
    "contactNo": "0345-2193299",
    "cnic": "42000-2342058-3",
    "ntn": "5235515-8",
    "srb": "S5235515-8"
  },
  {
    "code": "120009",
    "name": "SIGN TECHNICAL SERVICES",
    "nature": "GOODS / SERVICES",
    "address": "PLOT NO. 06, STREET-15, SECTOR-33/F, KORANGI NO-02, Korangi Korangi Town",
    "contactNo": "0300-0303648",
    "cnic": "42201-2887679-4",
    "ntn": "3531546-6"
  },
  {
    "code": "120010",
    "name": "QUALITY AVIATION (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "123-124 THE FORUM G-20 BLOCK-9 KHAYABAN-E-JAMI CLIFTON",
    "contactNo": "021-35831275",
    "ntn": "1019083-0",
    "srb": "S1019083-0"
  },
  {
    "code": "120011",
    "name": "LEOPARDS COURIER SERVICES",
    "nature": "SERVICES",
    "address": "46-E, E-MARKET, BLOCK-6, P.E.C.H.S., PLAZA SQUARE, KARACHI",
    "contactNo": "0345-2007712",
    "ntn": "2824502-4",
    "strn": "1200980800191",
    "srb": "S2824502-4",
    "pra": "P2824502-4"
  },
  {
    "code": "120012",
    "name": "THE WOODPECKER",
    "nature": "GOODS",
    "address": "Off# 2, 1st Floor, 3 Sister Lodge, Plote# 3/3, Commercial Area Bahadurabad, Karachi.",
    "contactNo": "021-38165643",
    "cnic": "42201-8491399-0",
    "ntn": "7269290-8",
    "srb": "S7269290-8"
  },
  {
    "code": "120013",
    "name": "FOUNTAIN AVENUE",
    "nature": "SERVICES",
    "address": "H No 64 Main Gulberg,Lahore",
    "contactNo": "0300-8416198",
    "cnic": "35202-7393725-5",
    "ntn": "1676773-0"
  },
  {
    "code": "120014",
    "name": "JOHAN (PVT) LTD.",
    "nature": "GOODS",
    "address": "F-17/A, Hub River Road, S.I.T.E, Karachi-75700",
    "contactNo": "0321-2598502",
    "ntn": "0814904-6",
    "strn": "1100220100346",
    "srb": "S0814904-6"
  },
  {
    "code": "120015",
    "name": "A2Z CREATORZ",
    "nature": "SERVICES",
    "address": "BUILDING NO. 64-C, 2ND FLOOR, 21ST COMMERCIAL STREET, PHASE-II, EXTN. D.H.A., Karachi South Saddar Town",
    "contactNo": "021-35385205",
    "cnic": "42201-0139906-1",
    "ntn": "2922455-1",
    "srb": "S2922455-1"
  },
  {
    "code": "120016",
    "name": "FALCON-I (PVT) LIMITED",
    "nature": "SERVICES",
    "address": "50-A/3 STREET # 2 GULSHAN-E-FAISAL BATH ISLAND, KARACHI",
    "contactNo": "0347-2223232",
    "ntn": "2868087-1",
    "strn": "Registered",
    "srb": "S2868087-1",
    "pra": "P2868087-1"
  },
  {
    "code": "120017",
    "name": "TPL TRAKKER LIMITED",
    "nature": "SERVICES",
    "address": "39-K PECHS BLOCK 6, Karachi",
    "contactNo": "0301-8283394",
    "ntn": "3269849-6",
    "strn": "Registered",
    "srb": "S3269849-6",
    "pra": "P3269849-6"
  },
  {
    "code": "120018",
    "name": "MULTINET PAKISTAN (PVT.) LIMITED",
    "nature": "SERVICES",
    "address": "1D-203,SECTOR#30,KORANGI INDUSTRIAL AREA, KARACHI",
    "contactNo": "111-021-021",
    "ntn": "1205953-6",
    "strn": "1712981200973",
    "srb": "S1205953-6",
    "pra": "P1205953-6"
  },
  {
    "code": "120019",
    "name": "MOHSIN TAYEBALY",
    "nature": "SERVICES",
    "address": "2nd Floor Dime Centre BC-4 Block 9 Kehkashan Clifton,Karachi",
    "contactNo": "021-325375659",
    "ntn": "2268154-0"
  },
  {
    "code": "120020",
    "name": "MEHRAN SERVICES",
    "nature": "GOODS",
    "address": "ROOM #216-A, 2ND FLOOR SUNNY PLAZA HASRAT MOHANI ROAD, KARACHI",
    "contactNo": "0335-2349257",
    "cnic": "42101-1369866-3",
    "ntn": "2399690-7"
  },
  {
    "code": "120021",
    "name": "PRINCELY TRAVELS",
    "nature": "SERVICES",
    "address": "14/15/16 Service club merewether road karachi",
    "contactNo": "021-35211081",
    "ntn": "1019158-5",
    "srb": "S1019158-5"
  },
  {
    "code": "120022",
    "name": "WASA",
    "nature": "SERVICES",
    "address": "Water reservoir, Shah Jamal Colony, Lahore.",
    "contactNo": "042-99205581"
  },
  {
    "code": "120023",
    "name": "KUN ADVERTISING AGENCY",
    "nature": "SERVICES",
    "address": "A-79, 1st Floor Sasi Arcade Block-7 Clifton Karachi",
    "contactNo": "0321-2426575",
    "cnic": "42201-0812648-3",
    "ntn": "1037442-6"
  },
  {
    "code": "120024",
    "name": "PRIME BUSINESS SYSTEMS",
    "nature": "GOODS",
    "address": "ROOM NO. 4-5, AMBER MOTEL, 51-H-1, BLOCK-6, P.E.C.H.S., KARACHI",
    "contactNo": "021-34546481",
    "cnic": "42101-1628774-5",
    "ntn": "2441897-8",
    "srb": "S2441897-8"
  },
  {
    "code": "120025",
    "name": "MAINETT PAKISTAN (PVT.) LTD.",
    "nature": "GOODS",
    "address": "PLOT NO., 1-C, 2nd FLOOR, LANE NO.6, BOKHARI COMMERCIAL AREA PHASE-VI, DHA KARACHI",
    "contactNo": "021-32427332",
    "ntn": "2277371-1",
    "strn": "Registered",
    "srb": "S2277371-1"
  },
  {
    "code": "120026",
    "name": "NASEER AUTOS",
    "nature": "GOODS / SERVICES",
    "address": "PLOT NO D-55 A/1-MAIN ESTATE AVENUE S.I.T.E. ,KARACHI",
    "contactNo": "021-32573266",
    "ntn": "0855892-2",
    "strn": "1200870310491",
    "srb": "S0855892-2"
  },
  {
    "code": "120027",
    "name": "PAPER MAGAZINE",
    "nature": "SERVICES",
    "address": "Office# 409, 410, 4th floor, D/1, Gulberg III, Lahore.",
    "contactNo": "0331-4817734",
    "ntn": "8973367-7"
  },
  {
    "code": "120028",
    "name": "NEW JUBILEE LIFE INSURANCE CO.",
    "nature": "SERVICES",
    "address": "74-1-A, LALAZAR M.T KHAN ROAD, KARACHI.",
    "contactNo": "021-35205095",
    "ntn": "0660564-8",
    "srb": "S0660564-8",
    "pra": "P0660564-8"
  },
  {
    "code": "120029",
    "name": "WATCHMAN SECURITY SYSTEM",
    "nature": "SERVICES",
    "address": "Flat No.01, Block No. 91, Street No. 34, I&T Centre G-10/1, Urban, ISLAMABAD",
    "contactNo": "0302-2429338",
    "ntn": "3013365-3",
    "strn": "3277876120336",
    "srb": "S3013365-3",
    "pra": "P3013365-3"
  },
  {
    "code": "120030",
    "name": "NICHE LIFE STYLE",
    "nature": "SERVICES",
    "address": "Office No. 125, 2nd Floor, Park Lane Tower, 172-Tufail Road, Lahore",
    "contactNo": "0345-4066553",
    "ntn": "6280499-2",
    "pra": "P6280499-2"
  },
  {
    "code": "120031",
    "name": "DOLMEN (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "18/C, Block-7/8, Shaheed-E-Millat Karachi",
    "contactNo": "021-34321120",
    "ntn": "0710245-3",
    "strn": "Registered",
    "srb": "S0710245-3"
  },
  {
    "code": "120032",
    "name": "PEARL BUTTON MFG CO.",
    "nature": "RENT",
    "address": "PLOT NO.1-6/12,SECTOR-5,KORANGI INDUSTRIAL AREA, KARACHI",
    "contactNo": "0300-2534436",
    "ntn": "0859655-7"
  },
  {
    "code": "120033",
    "name": "UNIVERSAL LOGISTICS SERVICES (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "12 BAHADURABAD, MAIN SHAHEED-E-MILLAT ROAD, KARACHI",
    "contactNo": "021-35148127",
    "ntn": "1343872-7",
    "strn": "Registered",
    "srb": "S1343872-7",
    "pra": "P1343872-7"
  },
  {
    "code": "120034",
    "name": "PRINCELY JETS (PVT) LIMITED",
    "nature": "SERVICES",
    "address": "Merewether Rd, Civil Lines, Karachi",
    "contactNo": "021 35674230"
  },
  {
    "code": "120035",
    "name": "SAIF PUBLISHIN (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "OFFICE NO. 7, 4TH FLOOR, KALSOOM PLAZA, BLUE AREA, Urban, ISLAMABAD",
    "contactNo": "021-32623961",
    "ntn": "3926343-6",
    "strn": "2600392634313"
  },
  {
    "code": "120036",
    "name": "SERVICES MESS KARACHI",
    "nature": "GOODS",
    "address": "Merewether Rd, Civil Lines, Karachi",
    "contactNo": "021-99201904"
  },
  {
    "code": "120037",
    "name": "ELEGANT PACKAGES",
    "nature": "GOODS",
    "address": "PLOT NO.C-28,SECTOR,32/A, KARACHI",
    "contactNo": "0331-9271525",
    "cnic": "35200-1529528-3",
    "ntn": "3413571-5"
  },
  {
    "code": "120038",
    "name": "ASIF ENTERPRISES",
    "nature": "GOODS",
    "address": "C-55 BLOCK 6 FEDERAL B.AREA, KARACHI",
    "cnic": "42101-1792122-9",
    "ntn": "1289204-1"
  },
  {
    "code": "120039",
    "name": "JILANI FLEXIBLE PACKAGES (PVT.) LTD.",
    "nature": "GOODS",
    "address": "F-312 S.I.T.E Karachi",
    "contactNo": "021-32582679",
    "ntn": "3094560-7",
    "strn": "1700392300582"
  },
  {
    "code": "120040",
    "name": "TCS (PRIVATE) LIMITED",
    "nature": "SERVICES",
    "address": "101-104, Civil Aviation Club Road, Karachi 75202.",
    "contactNo": "021-9242913"
  },
  {
    "code": "120041",
    "name": "AKBAR ENTERPRISES (PVT.) LIMITED",
    "nature": "SERVICES",
    "address": "#1 1ST FLOOR SERVICE CLUB EXT BUILDING MEREWEATHER ROAD, KARACHI",
    "contactNo": "021-35660317",
    "ntn": "1154710-3",
    "strn": "1600980300282"
  },
  {
    "code": "120042",
    "name": "ZAMAN TRANSPORT SERVICES",
    "nature": "SERVICES",
    "address": "PLOT NO.74/B,NEW SINDHI MUSLIM COLONY,BLOCK-6,PECHS, KARACHI",
    "contactNo": "0311-2002910",
    "cnic": "42201-0353470-5",
    "ntn": "4036915-3",
    "srb": "S4036915-3"
  },
  {
    "code": "120043",
    "name": "S.M. REHAN & CO.",
    "nature": "SERVICES",
    "address": "5TH FL SPOTLIT CHAMBERS, KARACHI",
    "contactNo": "021-35653677",
    "cnic": "42101-9288745-5",
    "ntn": "0788218-1",
    "srb": "S0788218-1"
  },
  {
    "code": "120044",
    "name": "PAK SUZUKI MOTOR CO. LTD.",
    "nature": "GOODS / SERVICES",
    "address": "DSU-13, PAKISTAN STEEL INDUSTRIAL ESTATE,BIN QASIM, KARACHI",
    "ntn": "0712837-1",
    "strn": "0214870300137",
    "srb": "S0712837-1",
    "pra": "P0712837-1"
  },
  {
    "code": "120045",
    "name": "PAK GULF CONSTRCTION (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "HOUSE NO. 176 GOMAL ROAD SECTOR E-7, ISLAMABAD",
    "contactNo": "051-8483010",
    "ntn": "2494327-4",
    "strn": "Registered",
    "pra": "2494327-4"
  },
  {
    "code": "120046",
    "name": "AL-SAFA GOLDEN CO (PVT.) LTD.",
    "nature": "RENT",
    "address": "5-A,JINNAH SUPER MARKET,F-7 MARKAZ, ISLAMABAD",
    "contactNo": "051-2656764",
    "ntn": "3911771-5"
  },
  {
    "code": "120047",
    "name": "SAFA GOLD MALL",
    "nature": "SERVICES",
    "address": "OFFICE,PLOT NO.5-A,JINNAH SUPER MARKET, F 7 MARKAZ, ISLAMABAD",
    "contactNo": "051-2656764",
    "cnic": "33106-4609456-2",
    "ntn": "2491985-3"
  },
  {
    "code": "120048",
    "name": "NISHAT HOTELS AND PROPERTIES LIMITED",
    "nature": "RENT / SERVICES",
    "address": "1-B,AZIZ AVENUE,CANAL BANK, GULBERG-V, LAHORE CITY",
    "contactNo": "042-32592114",
    "ntn": "3033263-0",
    "strn": "0303980103946",
    "pra": "P3033263-0"
  },
  {
    "code": "120049",
    "name": "CROWN TRAVELS",
    "nature": "SERVICES",
    "address": "ROOM NO.1,1ST FLOOR SERVICES CLUB EXT,BUILDING MEREWEATHER ROAD, KARACHI",
    "contactNo": "021-35660330",
    "ntn": "3199827-5",
    "strn": "1700319982712"
  },
  {
    "code": "120050",
    "name": "ARSHAD MUNIR SUPPLY & SERVICES",
    "nature": "GOODS",
    "address": "SECTOR 1-A,LINES AREA, SADDAR TOWN, KARACHI",
    "contactNo": "0300-8278849",
    "cnic": "31303-7861272-8",
    "ntn": "4245001-2"
  },
  {
    "code": "120051",
    "name": "KW&SB",
    "nature": "SERVICES",
    "address": "9th Mile Karsaz, Main Shahrah-e-Faisal, Karachi-75350.",
    "contactNo": "021-111597200"
  },
  {
    "code": "120052",
    "name": "FAZAL-E-RABBI (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "G-4/A & B, Court Road, Opp: Sindh Assembly Building, Karachi",
    "contactNo": "0321-3899199",
    "ntn": "0708850-7",
    "srb": "S0708850-7"
  },
  {
    "code": "120053",
    "name": "Dolmen Real Estate Management (Pvt.) Ltd.",
    "nature": "SERVICES",
    "address": "17TH FLOOR,THE HARBOUR FRONT HC-3 BLOCK 4,DOLMEN CITY, CLIFTON ROAD, KARACHI",
    "contactNo": "0311-3622974",
    "ntn": "4386954-8",
    "strn": "Registered",
    "srb": "S4386954-8",
    "pra": "P4386954-8"
  },
  {
    "code": "120054",
    "name": "CDC-TRUSTEE DOLMEN CITY REIT",
    "nature": "RENT",
    "address": "ARIF HABIB CENTRE,23 M.T.KHAN ROAD, KARACHI",
    "contactNo": "021-35296192",
    "ntn": "4360482-0",
    "strn": "Registered",
    "srb": "S4360482-0"
  },
  {
    "code": "120055",
    "name": "INDUS MOTOR CO. LTD.",
    "nature": "GOODS",
    "address": "Plot No. N. W. Z/1/P-1, Port Qasim Authority, Karachi",
    "contactNo": "021-34532246",
    "ntn": "0676546-7",
    "strn": "0204870300155",
    "srb": "S0676546-7"
  },
  {
    "code": "120056",
    "name": "TOYOTA CENTRAL MOTORS",
    "nature": "GOODS / SERVICES",
    "address": "3,MAIN SHAHRAH-E-FAISAL, KARACHI",
    "contactNo": "0346-8222370",
    "cnic": "42201-9097527-7",
    "ntn": "1055945-7",
    "strn": "1221999922337",
    "srb": "S1055945-7"
  },
  {
    "code": "120057",
    "name": "PREMIER AVIATION SERVICES (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "2ND FLOOR,SERVICES EXTENSTON BULDING,MEREWETHER ROAD, SADDAR TOWN, KARACHI",
    "contactNo": "021-35674684",
    "ntn": "0999489-7"
  },
  {
    "code": "120058",
    "name": "AL GHURAIR GIGA PAKISTAN (PVT.) LTD.",
    "nature": "RENT",
    "address": "DHA Phase-II,Sheikh Zaid Bin Alnahyan Road, ISLAMABAD",
    "contactNo": "051-8491040",
    "ntn": "2257464-6",
    "strn": "2601681000146",
    "srb": "S2257464-6",
    "pra": "P2257464-6"
  },
  {
    "code": "120059",
    "name": "EFU GENERAL - MARINE CARGO IMPORT",
    "nature": "SERVICES",
    "address": "EFU HOUSE,M.A JINNAH ROAD, KARACHI",
    "contactNo": "0300-8288838"
  },
  {
    "code": "120060",
    "name": "AMRELIWALA MOTORS (PVT.) LTD.",
    "nature": "GOODS / SERVICES",
    "address": "PLOT NO C-1, SITE, MANGHOPIR ROAD, Karachi West Site Town",
    "contactNo": "021-32570301",
    "ntn": "0704028-8",
    "strn": "1102999947619",
    "srb": "S0704028-8"
  },
  {
    "code": "120061",
    "name": "EOBI",
    "nature": "SERVICES",
    "address": "Third Floor (EOBI HOUSE) Awami Markaz, Main Shahrah-e-Faisal, Karachi.",
    "contactNo": "021-99244491"
  },
  {
    "code": "120062",
    "name": "INTELLEXAL SOLUTIONS (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "PLOT 12/J/6,P E C H S,OFFICE#107 FIRST FLOOR, KARACHI",
    "contactNo": "021-34331234",
    "ntn": "4140461-7",
    "strn": "Registered",
    "srb": "S4140461-7"
  },
  {
    "code": "120063",
    "name": "DHL PAKISTAN (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "22 BANGLORE TOWN MAIN SHAHRAH-E-FAISAL, KARACHI",
    "contactNo": "111-345-111",
    "ntn": "0816259-0",
    "strn": "1200980800437",
    "srb": "S0816259-0",
    "pra": "P0816259-0"
  },
  {
    "code": "120064",
    "name": "SIGN TECHNICAL SERVICES (FBR)",
    "nature": "GOODS / SERVICES",
    "address": "PLOT NO.8 STREET NO.15 SECTOR 33/F KORANGI NO.2, KARACHI",
    "contactNo": "0300-0303648",
    "cnic": "42201-1870411-5",
    "ntn": "2263257-3",
    "strn": "1700980200937",
    "srb": "S2263257-3"
  },
  {
    "code": "120065",
    "name": "EBCO (PVT.) LIMITED",
    "nature": "SERVICES",
    "address": "SUITE NO. 123-124 THE FORUM G-20 BLOCK-9 KHAYABAN-E-JAMI CLIFTON",
    "contactNo": "021-3561660",
    "ntn": "7266041-8",
    "srb": "S7266041-8"
  },
  {
    "code": "120066",
    "name": "LUCKY LANDMARK (PVT.) LTD.",
    "nature": "RENT / SERVICES",
    "address": "L-A, 2/B, BLOCK-21, FEDERAL-B-AREA, KARACHI CENTRAL",
    "contactNo": "021-36321311",
    "ntn": "4353381-7",
    "strn": "3277876135568",
    "srb": "S4353381-7"
  },
  {
    "code": "120067",
    "name": "IMPERIAL FACILITY MANAGEMENT (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "Office No 08, DHA Phase-II, Gate-II, Main G.T Road, Urban, ISLAMABAD",
    "contactNo": "051-8491040",
    "ntn": "7235181-0",
    "strn": "3277876128970"
  },
  {
    "code": "120068",
    "name": "SUZUKI MACCA MOTORS",
    "nature": "GOODS / SERVICES",
    "address": "FL-8-9-10-11,GULSHAN-E-JAMAL,RASHID MINHAS ROAD, KARACHI",
    "cnic": "42301-0609454-8",
    "ntn": "3816182-6",
    "strn": "1700381618215",
    "srb": "S3816182-6"
  },
  {
    "code": "120069",
    "name": "AL BARKA WATER",
    "nature": "GOODS",
    "address": "51/C,SATELLITE TOWN, SARGODHA",
    "contactNo": "0300-6042416",
    "ntn": "2503648-3",
    "strn": "2400250364813"
  },
  {
    "code": "120070",
    "name": "IBL OPERATION (PVT.) LTD.",
    "nature": "GOODS",
    "address": "9TH FLOOR,NIC BUILDING,ABBASI SHAHEED ROAD, SHARA E FAISAL, KARACHI",
    "ntn": "3676651-8",
    "strn": "1700367665115",
    "srb": "S3676651-8"
  },
  {
    "code": "120071",
    "name": "BRANDANIA ADGOS",
    "nature": "GOODS",
    "address": "OFFICE#290-B,MAIN MKT OPP REGENT HOTEL,COMMITTEE CHOWK, RAWALPINDI",
    "contactNo": "0310-5445214",
    "cnic": "37101-1800344-1",
    "ntn": "3527787-4",
    "strn": "2300352778712",
    "pra": "P3527787-4"
  },
  {
    "code": "120072",
    "name": "CYBER INTERNET SERVICES (PVT.) LIMITED",
    "nature": "SERVICES",
    "address": "A-904 9TH FLOOR LAKSON SQUARE SARWAR SHAHEED ROAD, KARACHI",
    "contactNo": "111-178-676",
    "ntn": "0660563-0",
    "strn": "1200851700628",
    "srb": "S0660563-0",
    "pra": "P0660563-0"
  },
  {
    "code": "120073",
    "name": "PEOPLE MAGAZINE PAKISTAN",
    "nature": "SERVICES",
    "address": "20-D, COMMERCIAL A MARKET, PHASE-2,DHA, Karachi South Saddar Town",
    "contactNo": "021-35311781",
    "cnic": "42301-1493637-9",
    "ntn": "2537197-5"
  },
  {
    "code": "120074",
    "name": "PULSE INTERNATIONAL",
    "nature": "GOODS",
    "address": "B-162, BLOCK W, ALLAMA IQBAL TOWN, NORTH NAZIMABAD, KARACHI CENTRAL",
    "contactNo": "0332-2331400",
    "ntn": "7285480-7"
  },
  {
    "code": "120075",
    "name": "AAM DEVELOPERS (PVT.) LTD.",
    "nature": "RENT / SERVICES",
    "address": "NEAR TOYOTA MULTAN BUILDING, BOSAN ROAD, SHALIMAR COLONY, Multan",
    "contactNo": "061-4424292",
    "ntn": "4245339-9",
    "strn": "Registered",
    "pra": "P4245339-9"
  },
  {
    "code": "120076",
    "name": "PREMIER DEVELOPERS",
    "nature": "RENT / SERVICES",
    "address": "44A, SAEED COLONY, CANAL ROAD, Faisalabad",
    "contactNo": "041-2421446",
    "cnic": "17201-5823478-5",
    "ntn": "0207010-3",
    "strn": "Registered",
    "pra": "P0207010-3"
  },
  {
    "code": "120077",
    "name": "SAFA MANAGEMENT SERVICES",
    "nature": "SERVICES",
    "address": "PLOT NO 16, MAIN DOUBLE, ROAD, F-11/1, Urban, ISLAMABAD",
    "contactNo": "051-2656766",
    "ntn": "7955042-5",
    "strn": "Registered"
  },
  {
    "code": "120078",
    "name": "CYBER SOFTWARE",
    "nature": "SERVICES",
    "address": "603, Westland Trade Centre, Block 7 & 8, KCHS Baloch Colony Flyover, Karachi",
    "contactNo": "0300-9242736",
    "cnic": "42000-0484845-1",
    "ntn": "0518139-9",
    "srb": "S0518139-9"
  },
  {
    "code": "120079",
    "name": "BAHRIA TOWN (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "Super Highway, Bahria Town Karachi",
    "contactNo": "0800 00100"
  },
  {
    "code": "120080",
    "name": "KINETIC BUSINESS SOLUTIONS",
    "nature": "SERVICES",
    "address": "Plot # 27, Sector No 15, Korangi Industrial Area, Karachi",
    "contactNo": "0317-2298929",
    "ntn": "4395126-7",
    "strn": "3277876220786",
    "srb": "S4395126-7",
    "pra": "P4395126-7"
  },
  {
    "code": "120081",
    "name": "PACKAGES REAL ESTATE (PVT.) LTD.",
    "nature": "RENT / SERVICES",
    "address": "SHAHRAH-E-ROOMI, P.O AMER SIDHU, LAHORE CANTT",
    "contactNo": "042-35811541",
    "ntn": "2606088-4",
    "strn": "0302681001682",
    "srb": "S2606088-4",
    "pra": "P2606088-4"
  },
  {
    "code": "120082",
    "name": "ALI RAZA",
    "nature": "RENT",
    "address": "H. No.F-788, SATELLITE TOWN, RAWALPINDI",
    "contactNo": "051-8491040",
    "cnic": "37405-0642287-7",
    "ntn": "2389926-3"
  },
  {
    "code": "120083",
    "name": "Quality Construction (Pvt.) Limited",
    "nature": "SERVICES",
    "address": "123-124 THE FORUM G-20 BLOCK-9 KHAYABAN-E-JAMI CLIFTON",
    "contactNo": "021-35831275",
    "ntn": "1019083-0",
    "srb": "S1019083-0"
  },
  {
    "code": "120084",
    "name": "THE TIMES PRESS (PRIVATE) LIMITED",
    "nature": "GOODS",
    "address": "C-18, Al-Hilal Society, Off University Road, Karachi",
    "contactNo": "021-34932931",
    "ntn": "0712417-1",
    "strn": "0215844200837"
  },
  {
    "code": "120085",
    "name": "GRAPHEME STUDIO",
    "nature": "GOODS",
    "address": "PLOT # 927/928,SUIT # 202, AL-MUSTAFA CENTER,BLOCK-2 P.E.C.H.S., KARACHI",
    "contactNo": "0345-2744507",
    "cnic": "42101-3219198-9",
    "ntn": "3795544-6"
  },
  {
    "code": "120086",
    "name": "LESCO",
    "nature": "SERVICES",
    "address": "LESCO Head Quarter, 22-A Queens Road Lahore",
    "contactNo": "042-99205248"
  },
  {
    "code": "120087",
    "name": "K-ELECTRIC",
    "nature": "SERVICES",
    "address": "KE House, 39-B, Sunset Boulevard, Phase-II, DHA, Karachi.",
    "contactNo": "021-3263 7133"
  },
  {
    "code": "120088",
    "name": "INDUS FUMIGATION",
    "nature": "SERVICES",
    "address": "R-346, Sector 8-B, Abbysina Line, Shahrah-e-Faisal, Karachi",
    "contactNo": "021-32784960",
    "cnic": "42101-5682932-8",
    "ntn": "4205960-7",
    "srb": "S4205960-7"
  },
  {
    "code": "120089",
    "name": "AM INNOVATION",
    "nature": "GOODS",
    "address": "Suit No16-B, Zulljalal Center Main, Tariq Road, Karachi",
    "contactNo": "0332-3486174",
    "cnic": "42201-4308810-5",
    "ntn": "7123929-6"
  },
  {
    "code": "120090",
    "name": "AQUA BLISS",
    "nature": "GOODS",
    "address": "House# 697-L, Sector 5 A 3, Gulshan Liaquat, North Karachi, Karachi.",
    "contactNo": "0301-2800371",
    "cnic": "42101-4378357-3"
  },
  {
    "code": "120091",
    "name": "MONTHLY BRANDS",
    "nature": "SERVICES",
    "address": "20-D, COMMERCIAL A MARKET, PHASE-2,DHA, Karachi",
    "contactNo": "0321-9039871",
    "cnic": "42301-1493637-9",
    "ntn": "2537197-5"
  },
  {
    "code": "120092",
    "name": "SOUTHERN PEARL INTERNATIONAL SERVICES (PVT.) LTD.",
    "nature": "GOODS",
    "address": "HOUSE NO,1, ST NO,17 D BLOCK F, NAVAL ANCHORAGE IBD, Islamabad",
    "contactNo": "033-111-110-52",
    "cnic": "32778-7614968-6",
    "ntn": "8905555-1",
    "strn": "Registered"
  },
  {
    "code": "120093",
    "name": "WONDER ADVERTISER AND ENGG SERVICES",
    "nature": "GOODS",
    "address": "PLOT NO-4 SECTOR 33-F ST-14 NEAR VITA CHOWRANGI ,KARACHI",
    "cnic": "42201-4959175-1",
    "ntn": "2926963-6",
    "strn": "1701999901946",
    "srb": "S2926963-6"
  },
  {
    "code": "120094",
    "name": "BIG EYE",
    "nature": "GOODS",
    "address": "IST FLOOR, PLOT NO.8, BLOCK B1, MAIN BOULEVARD, PIA HOUSING SOCIETY, LAHORE",
    "contactNo": "0345-4054484",
    "ntn": "7992643-4",
    "strn": "3277876157781"
  },
  {
    "code": "120095",
    "name": "THE LEGEND",
    "nature": "GOODS",
    "address": "PLOT NO 1-C, STREET,7A,BADAR COMMERCIAL, PHASE-V EXT DHA, Karachi",
    "brands": [
      "TISSOT",
      "RADO"
    ],
    "contactNo": "021-33411654",
    "ntn": "1558685-5",
    "strn": "1200910000146"
  },
  {
    "code": "120096",
    "name": "AXLE AND OLIO SOLUTIONS PAKISTAN (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "111/4,, STREET 26, OFF: KHAYABAN-E-KHALID,, D.H.A., PHASE - VIII",
    "contactNo": "0343-3016460",
    "ntn": "8243861-5",
    "srb": "S8243861-5"
  },
  {
    "code": "120097",
    "name": "FAWAD ASGHAR",
    "nature": "RENT",
    "address": "P-3 RAZA TOWN CANAL ROAD, Faisalabad",
    "contactNo": "0344-6600661",
    "cnic": "33100-1216001-7",
    "ntn": "2868652-7"
  },
  {
    "code": "120098",
    "name": "ROBINA KAUSAR",
    "nature": "RENT",
    "address": "27 - PARADISE VALLEY, STREE MASJAD WALI, SHEIKHUPURA ROAD, Faisalabad",
    "contactNo": "0344-6600661",
    "cnic": "33104-7369214-2",
    "ntn": "5114135-2"
  },
  {
    "code": "120099",
    "name": "KINGSON - REAL ESTATE",
    "nature": "RENT / SERVICES",
    "address": "1, SHOP NO. SB-05/12 (KINGSON INTERNATIONAL) KARACHI",
    "contactNo": "0333-2142387",
    "cnic": "42201-0523274-0",
    "ntn": "2261715-9",
    "strn": "Registered"
  },
  {
    "code": "120100",
    "name": "NETSAT (PRIVATE) LIMITED",
    "nature": "SERVICES",
    "address": "Plot No. 87/10 Sector 5, BEH DIH, Korangi Industrial Area, Karachi",
    "contactNo": "0301-8114160",
    "ntn": "2792898-5",
    "strn": "1750999934128",
    "srb": "S2792898-5",
    "pra": "P2792898-5"
  },
  {
    "code": "120101",
    "name": "ELAHEE BUKSH & COMPANY (PVT.) LTD.",
    "nature": "RENT",
    "address": "123-124, THE FORUM, G 20, BLOCK - IX, CLIFTON, Karachi",
    "ntn": "1875164-4",
    "strn": "Registered"
  },
  {
    "code": "120102",
    "name": "AERO PACKAGES",
    "nature": "GOODS",
    "address": "SHOP No.4, HUSSAIN ARCADE, BURNS ROAD, STREET No.10, Karachi",
    "contactNo": "0300-8248796",
    "cnic": "42201-0484403-0",
    "ntn": "8171362-1",
    "strn": "3277876198441"
  },
  {
    "code": "120103",
    "name": "MUHAMMAD AWAIS",
    "nature": "RENT",
    "address": "P-413, TARIQABAD, ,, Faisalabad",
    "contactNo": "0344-6600661",
    "cnic": "33100-9539511-9",
    "ntn": "7565049-0"
  },
  {
    "code": "120104",
    "name": "AHSAN ABBAS KAZMI",
    "nature": "RENT",
    "address": "KARACHI",
    "cnic": "37405-8100673-3",
    "ntn": "3720613-3"
  },
  {
    "code": "120105",
    "name": "RAMNA PREMIUM DRINKING WATER",
    "nature": "GOODS",
    "address": "RAMNA HOUSE 63A/2 ABU BAKAR BLOCK, NEW GARDEN TOWN, LAHORE",
    "contactNo": "0322-4990249",
    "cnic": "35202-6767230-1",
    "ntn": "3402355-7"
  },
  {
    "code": "120106",
    "name": "INTERNATIONAL WATCH COMPANY",
    "nature": "GOODS",
    "address": "SHOP NO-4 LAKSHMI BULIDING GROUND FLOOR M.A.JINNAH ROAD",
    "contactNo": "042-35871370",
    "cnic": "42201-0523274-0",
    "ntn": "2261715-9",
    "strn": "Registered"
  },
  {
    "code": "120107",
    "name": "PARAMOUNT ENTERPRISES (PVT.) LTD.",
    "nature": "GOODS",
    "address": "1ST FLOOR DEAN ARCADE BLOCK -8 CLIFTON",
    "brands": [
      "GUESS"
    ],
    "contactNo": "021-35837447",
    "ntn": "1548234-7",
    "strn": "Registered"
  },
  {
    "code": "120108",
    "name": "SPEED ENTERPRISES",
    "nature": "GOODS",
    "address": "314-315 3RD FLOOR THE FORUM, G-20, MAIN KHAYABAN-E-JAMI, CLIFTON",
    "ntn": "3037492-8",
    "strn": "1700910000273"
  },
  {
    "code": "120109",
    "name": "NAYAB PEST CONTROL SERVICES",
    "nature": "SERVICES",
    "address": "44 LGF CENTRAL PLAZA BARKET MARKET NEW GARDEN TOWN, LAHORE",
    "contactNo": "0300-6945607",
    "ntn": "2061541-8",
    "strn": "0302380801773",
    "pra": "P2061541-8"
  },
  {
    "code": "120110",
    "name": "FLOW MASTER",
    "nature": "GOODS / SERVICES",
    "address": "Office # 203, 2nd Floor, Shahwar Trade Centre, P.E.C.H.S., Karachi",
    "contactNo": "0345-3115524",
    "cnic": "42201-6919762-7",
    "ntn": "7560750-3",
    "srb": "S7560750-3"
  },
  {
    "code": "120111",
    "name": "MUNSEEB (PVT.) LTD.",
    "nature": "GOODS",
    "address": "House No. 52-B/1, Khayaban-e-Shahbaz Phase VII, DHA Karachi",
    "contactNo": "0301-8221896",
    "ntn": "5230525-4",
    "strn": "3277876157986"
  },
  {
    "code": "120112",
    "name": "7SIGN",
    "nature": "GOODS",
    "address": "HOUSE NO. B-60, AL HOUSING SOCIETY, HALT KARACHI",
    "cnic": "42501-7759095-3",
    "ntn": "4026346-7",
    "strn": "1700402634611",
    "srb": "S4026346-7"
  },
  {
    "code": "120113",
    "name": "CONCEPTIONAL MARKETING SOLUTIONS",
    "nature": "GOODS",
    "address": "House no.1119, St-11B, Makkah Colony, Lahore",
    "contactNo": "0321-4239756",
    "cnic": "35201-4161560-3",
    "ntn": "A227051-8"
  },
  {
    "code": "120114",
    "name": "LUCKY MOTOR CORPORATION LTD.",
    "nature": "GOODS / SERVICES",
    "address": "Arabian Sea Country Club Road, Bin Qasim Industrial Park, Karachi",
    "ntn": "7357373-8",
    "strn": "Registered",
    "srb": "S7357373-8",
    "pra": "P7357373-8"
  },
  {
    "code": "120115",
    "name": "HONDA ATLAS CARS (PAKISTAN) LTD.",
    "nature": "GOODS / SERVICES",
    "address": "43 K.M.MULTAN ROAD MANGA MANDI, LAHORE",
    "cnic": "0305870300137",
    "ntn": "0829237-0",
    "strn": "Registered",
    "srb": "S0829237-0",
    "pra": "P0829237-0"
  },
  {
    "code": "120116",
    "name": "MATEEN SONS",
    "nature": "GOODS",
    "address": "C-109 Sector, 32 A Korangi, Karachi",
    "cnic": "42000-0570091-1",
    "ntn": "0293679-8",
    "strn": "Registered"
  },
  {
    "code": "120117",
    "name": "REANDA HAROON ZAKARIA ASSOCIATES",
    "nature": "SERVICES",
    "address": "Office No. M1 - M4, Progressive Plaza, Beaumont Road, Karachi",
    "contactNo": "021-35674741",
    "ntn": "8965119-3",
    "srb": "S8965119-3"
  },
  {
    "code": "120118",
    "name": "KIA MOTOR SITE",
    "nature": "GOODS / SERVICES",
    "address": "X-2, Manghopir Road, S.I.T.E, Karachi",
    "contactNo": "021-32570082",
    "cnic": "42201-5701403-1",
    "ntn": "3998159-2",
    "strn": "Registered",
    "srb": "S3998159-2"
  },
  {
    "code": "120119",
    "name": "HONDA SOUTH (PVT.) LTD.",
    "nature": "GOODS / SERVICES",
    "address": "1-B/1 SECTOR#23,KORANGI INDUSTRIAL AREA, KIA, KARACHI",
    "contactNo": "021-35050251",
    "ntn": "0984519-4",
    "strn": "1712870820191",
    "srb": "S0984519-4"
  },
  {
    "code": "120120",
    "name": "DHA DOLMEN LAHORE (PVT.) LTD.",
    "nature": "RENT",
    "address": "Plot# 158, Sector A, DHA, Phase VI, Lahore",
    "contactNo": "021-32603449",
    "ntn": "5298402-3",
    "strn": "Registered",
    "pra": "P5298402-3"
  },
  {
    "code": "120121",
    "name": "Universal Network Systems (Pvt.) Ltd.",
    "nature": "SERVICES",
    "address": "Suit# 606 TRADE TOWER ABDULLAH HAROON ROAD, KARACHI",
    "ntn": "2691562-6",
    "strn": "Registered",
    "srb": "S2691562-6",
    "pra": "P2691562-6"
  },
  {
    "code": "120122",
    "name": "PESSI",
    "nature": "SERVICES",
    "address": "3-A, Gulberg-V, Jail Road, Lahore",
    "contactNo": "042-99263107"
  },
  {
    "code": "120123",
    "name": "SESSI",
    "nature": "SERVICES",
    "address": "Block 6 Gulshan-e-Iqbal, Karachi",
    "contactNo": "021-99243813"
  },
  {
    "code": "120124",
    "name": "PAK LOGISTICS SOLUTIONS",
    "nature": "SERVICES",
    "address": "49 / A, BLOCK – 2, P.E.C.H.S. , KARACHI",
    "contactNo": "0300-2222412",
    "ntn": "4578604-3",
    "strn": "Registered",
    "srb": "S4578604-3",
    "pra": "P4578604-3"
  },
  {
    "code": "120125",
    "name": "ASAF ALI HUSSAIN",
    "nature": "RENT",
    "address": "HOUSE NO D-22 BLOCK 7 CLIFTON",
    "cnic": "42301-9918072-3",
    "ntn": "2254196-9",
    "strn": "Registered"
  },
  {
    "code": "120126",
    "name": "SARFRAZ AHMED",
    "nature": "RENT",
    "address": "House# 17 Block-C, Gulberg Colony, Faisalabad",
    "contactNo": "0344-6600661",
    "cnic": "33102-1818518-7",
    "ntn": "0058555-6",
    "strn": "Registered"
  },
  {
    "code": "120127",
    "name": "LEOPARDS COURIER SERVICES (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "46-E, E-MARKET, BLOCK-6, P.E.C.H.S., PLAZA SQUARE, KARACHI",
    "contactNo": "021-34532392",
    "ntn": "2824502-4",
    "strn": "1200980800191",
    "srb": "S2824502-4",
    "pra": "P2824502-4"
  },
  {
    "code": "120128",
    "name": "APCO PARK ONE (PRIVATE) LIMITED",
    "nature": "RENT / SERVICES",
    "address": "Head Office # 54, Margalla Raod, F-8/2, Islamabad",
    "contactNo": "051-2266104"
  },
  {
    "code": "120129",
    "name": "ABDUL HANNAN",
    "nature": "RENT",
    "address": "Plot# 3-103, C P Berar 1st Floor, Left Side, Karachi",
    "cnic": "42301-6853276-7",
    "ntn": "7154631-0"
  },
  {
    "code": "120130",
    "name": "MUHAMMAD ANIS",
    "nature": "RENT",
    "address": "House# 103, Street# 9, Block 3, C.P Berrar Society Sharfabad, Karachi",
    "cnic": "42301-0954438-9",
    "ntn": "D673376-5"
  },
  {
    "code": "120131",
    "name": "MRS MEHFOOZA BANO",
    "nature": "RENT",
    "address": "Wali Garden 2nd Floor Plot# 141, Fuwara Chowk Flat# 203, Karachi",
    "cnic": "42401-7164919-2",
    "ntn": "2304569-8"
  },
  {
    "code": "120132",
    "name": "GRANT THORNTON ANJUM RAHMAN",
    "nature": "SERVICES",
    "address": "1st & 3rd Floor, Modern Motors House, Beaumont Road, Karachi",
    "contactNo": "021-35672951",
    "ntn": "1473393-5",
    "strn": "Registered",
    "srb": "S1473393-5",
    "pra": "P1473393-5"
  },
  {
    "code": "120133",
    "name": "HOTEL HILLVIEW (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "BLOCK NO12-A,MARKEZ F-7, ISLAMABAD",
    "contactNo": "0321-5157470",
    "ntn": "2812327-1",
    "strn": "Registered"
  },
  {
    "code": "120134",
    "name": "SAFE & SECURE SYSTEMS",
    "nature": "GOODS",
    "address": "A-214, Block-13, Gulistan-e-Johar, Karachi",
    "contactNo": "0332-8289201",
    "cnic": "42101-1404192-9",
    "ntn": "7298156-2",
    "strn": "Registered",
    "srb": "S7298156-2"
  },
  {
    "code": "120135",
    "name": "POSTECH ENTERPRISES",
    "nature": "GOODS",
    "address": "D-227/B, SITE, KARACHI WEST",
    "contactNo": "0317-8220585",
    "ntn": "A118571-5",
    "strn": "Registered",
    "srb": "SA118571-5"
  },
  {
    "code": "120136",
    "name": "PAKO COMPUTERS",
    "nature": "GOODS",
    "address": "10, GROUND FLOOR, BUSINESS ARCADE, BLOCK-6, P.E.C.H.S., KARACHI",
    "contactNo": "0321-2351484",
    "ntn": "1432726-7",
    "strn": "1700850009919",
    "srb": "S1432726-7",
    "pra": "P1432726-7"
  },
  {
    "code": "120137",
    "name": "THE FRESH DROPS",
    "nature": "GOODS",
    "address": "A-157, Block 13-A, Railway Society Gulshan-E-Iqbal, Karachi",
    "contactNo": "0334-9575615",
    "cnic": "42201-7174976-1",
    "ntn": "7938387-0"
  },
  {
    "code": "120138",
    "name": "H.N TECH SERVICES",
    "nature": "GOODS",
    "address": "Plot# l-59, St-12 Scetor 31 / b, KDA Employees Housing Society, Karachi",
    "contactNo": "0300-3641332",
    "cnic": "31303-4432570-7",
    "ntn": "9285831-0"
  },
  {
    "code": "120139",
    "name": "SUPER LINE PEST CONTROL",
    "nature": "SERVICES",
    "address": "House# 1, Mohalla Ahmad Street, Bahar Colony Kot Lakhpat, Lahore.",
    "contactNo": "0308-4885611",
    "cnic": "35201-4484094-6",
    "ntn": "E439736-5"
  },
  {
    "code": "120140",
    "name": "NEOCOM",
    "nature": "GOODS",
    "address": "FLAT NO.104, PLOT NO.164/3, BAHADURABAD CENTER, BMCHS, Karachi",
    "contactNo": "0333-3095987",
    "cnic": "42201-7180115-9",
    "ntn": "1358557-6",
    "strn": "Registered",
    "srb": "S1358557-6",
    "pra": "P1358557-6"
  },
  {
    "code": "120141",
    "name": "KARACHI CHAMBER OF COMMERCE AND INDUSTRY",
    "nature": "SERVICES",
    "address": "Aiwan-e-Tijarat Road, off: Shahrah-e-liaquat, P.O. Box# 4158, Karachi.",
    "contactNo": "021-99218001"
  },
  {
    "code": "120142",
    "name": "THE AMERICAN BUSINESS COUNCIL OF PAKISTAN",
    "nature": "SERVICES",
    "address": "55-C, 3rd Floor, Al-Murtaza Commercial, Lane-2, Phase 8-A, DHA, Karachi.",
    "contactNo": "021-35248915"
  },
  {
    "code": "120143",
    "name": "SPRINT SERVICES RAWALPINDI LIMITED",
    "nature": "RENT",
    "address": "14 Floor, BRR Tower, I I Chundrigar Road, Karachi",
    "contactNo": "0300-6976631",
    "ntn": "3053809-2",
    "strn": "Registered",
    "pra": "P3053809-2"
  },
  {
    "code": "120144",
    "name": "HIMS ENTERPRISES",
    "nature": "RENT",
    "address": "Plot No. 3, Sector 40, DEH Mehran-1, Malir, Karachi.",
    "contactNo": "0333-8688007",
    "ntn": "7335779-5"
  },
  {
    "code": "120145",
    "name": "WAQAS LIAQAT",
    "nature": "RENT",
    "address": "House No. 1499/2-A Main Street Khawaja Colony Faizi Road",
    "cnic": "36302-4630060-1",
    "ntn": "0954992-7"
  },
  {
    "code": "120146",
    "name": "FAIZAN MUSHTAQ",
    "nature": "RENT",
    "address": "House No. 1498/9/1 Street No. 1 Khawaja Colony Faizi Road",
    "cnic": "36302-8126368-9",
    "ntn": "3377242-8"
  },
  {
    "code": "120147",
    "name": "INNOVATIVE NETWORK (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "Bungalow No. 41, J/III, Mehmood Hassan Road, Block 6 PECHS, Karachi",
    "contactNo": "0316-2467066",
    "ntn": "7224220-1",
    "srb": "S7224220-1"
  },
  {
    "code": "120148",
    "name": "STRATEGIC ENTERPRISES",
    "nature": "SERVICES",
    "address": "138, K.J Arcade, 16th Street, Phase I, DHA, Karachi.",
    "contactNo": "021-34490035",
    "ntn": "G212735-2",
    "srb": "SG212735-2"
  },
  {
    "code": "120149",
    "name": "ALLIED RECORD MANAGEMENT CO (PVT) LTD.",
    "nature": "SERVICES",
    "address": "Portion A-8, Plot NC-362, Deh Joriji, Bin Qasim Town, Karachi",
    "contactNo": "0349-0236369",
    "ntn": "4377230-7",
    "strn": "Registered",
    "srb": "S4377230-7"
  },
  {
    "code": "120150",
    "name": "OTHERS P/A",
    "nature": "SERVICES/GOODS",
    "address": "Office No. 1st Floor, Services Club, Ext. Building Mereweather Road, Karachi",
    "contactNo": "021-35652161"
  },
  {
    "code": "120151",
    "name": "PROVISION OF SRB-RENT",
    "nature": "RENT",
    "address": "Office No. 1st Floor, Services Club, Ext. Building Mereweather Road, Karachi",
    "contactNo": "021-35652161"
  },
  {
    "code": "120152",
    "name": "MUHAMMAD IMRAN",
    "nature": "RENT",
    "address": "House No. 113/1, Street No.31, Khayaban-e-Rahat, Phase-6 Karachi",
    "ntn": "1179343-7"
  },
  {
    "code": "120153",
    "name": "MUHAMMAD KAMRAN",
    "nature": "RENT",
    "address": "House No. 09, Street No. 01, Sunset Link, No. 1, Phase 2, DHA Karachi",
    "ntn": "2121225-2"
  },
  {
    "code": "120154",
    "name": "ENAARA FACILITIES MANAGEMENT SERVICES (PVT.) LTD.",
    "nature": "SERVICES",
    "address": "56 B-3, Gulberg III, Lahore",
    "contactNo": "0345-5882936",
    "ntn": "9918097-7"
  },
  {
    "code": "120155",
    "name": "YENNISARIES SECURITY SERVICES (SMC-PVT) LTD.",
    "nature": "SERVICES",
    "address": "Head Off. Flat No. 3 1st Floor, Ghosia Plaza, Main Market, Gulberg II, Lahore",
    "contactNo": "0300-2074792",
    "ntn": "1461408-1",
    "strn": "Registered",
    "pra": "P1461408"
  },
  {
    "code": "120156",
    "name": "JOMO TECHNOLOGIES (PVT.) LTD.",
    "nature": "GOODS",
    "address": "SERVIS HOUSE,, 2-MAIN GULBERG, Lahore",
    "ntn": "8274528-0"
  },
  {
    "code": "120157",
    "name": "HERO TAMEER LIMITED",
    "nature": "RENT",
    "address": "HOUSE NO. 139/B HDA KHOSAR SOCIETY",
    "ntn": "4427402-5"
  },
  {
    "code": "120158",
    "name": "CDC - TRUSTEE DHA DOLMEN LAHORE REIT",
    "nature": "RENT",
    "address": "CDC House, 99-B, Block “B” S.M.C.H.S. Main Shahrah-e-Faisal, Karachi."
  },
  {
    "code": "120159",
    "name": "TAG HEUER SA-SWITZERLAND",
    "nature": "GOODS",
    "address": "Office No. 1st Floor, Services Club, Ext. Building Mereweather Road, Karachi",
    "brands": [
      "TAG HEUER"
    ]
  },
  {
    "code": "120160",
    "name": "NAYATEL (PRIVATE) LIMITED",
    "nature": "SERVICES",
    "address": "72-F, 1st Floor, Nayatel Building, Nazim-ud-Din Road, F-7/4, Islamabad",
    "contactNo": "51 111 11 44 44",
    "ntn": "2161818-6"
  },
  {
    "code": "120161",
    "name": "WATEEN TELECOM LIMITED",
    "nature": "SERVICES",
    "address": "31/1 A, Pakistan Employees Co-Operative Housing Society, Block-6, Karachi",
    "contactNo": "(021) 111 365 111",
    "ntn": "7974036-0"
  }
];

const vendorsLocal: VendorSeed[] = rawLocalVendors.map(v => ({
  ...v,
  accountCodes: getAccountCodes(v.nature),
}));

const vendorsImport: VendorSeed[] = [
  // Sports Brands → 12010001
  { code: 'IMP001', brands: ['NIKE'],         name: 'NIKE GLOBAL TRADING BV SINGAPORE BRANCH', nature: 'GOODS', address: '30 Pasir Panjang Road No. 10-31/32, Mapletree Business City, Singapore 117440', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP002', brands: ['NIKE'],         name: 'OD360 PTE LTD',                            nature: 'GOODS', address: '119 Genting Lane, #03-00, HB@ 119 Genting, Singapore, 349570', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP003', brands: ['ADIDAS'],       name: 'ADIDAS EMERGING MARKETS FZE',              nature: 'GOODS', address: 'Dubai Design District (d3), Building No.2 4th Floor 32512 Dubai, UAE', contactNo: '971-4-5123500', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP004', brands: ['ASICS'],        name: 'ASICS ARABIA FZE',                         nature: 'GOODS', address: 'ASICS Middle East Trading L.L.C. Unit 307B, Building No. 5, P.O. Box 49774 Dubai Design District, Dubai, UAE', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP005', brands: ['BIRKENSTOCK'],  name: 'BIRKENSTOCK GLOBAL SALES GMBH',            nature: 'GOODS', address: 'Birkenstock Logistics GmbH Burg Ockenfels 53545 Linz am Rhein Germany', contactNo: '+49 2683 9359 0', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP006', brands: ['PUMA'],         name: 'PUMA SOUTH EAST ASIA PTE LTD',             nature: 'GOODS', address: 'PUMA MIDDLE EAST FZ-LLC P.O. BOX 500626 DUBAI, UAE', contactNo: '971-4-5621222', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP007', brands: ['UNDER ARMOUR'], name: 'UA SPORTS (S.E.A.) PTE. LTD.',             nature: 'GOODS', address: '7 Temasek Boulevard, #25-01, Suntec Tower One Singapore 038987 SGP', contactNo: '+65 6225 2881', accountCodes: getImportAccountCodes('SPORTS') },
  
  // Fashion Brands → 12010002
  { code: 'IMP008', brands: ['CHARLES & KEITH', 'PEDRO'], name: 'CHARLES & KEITH INTERNATIONAL PTE LTD', nature: 'GOODS', address: '6 Tai Seng Link, Level 8 Charles & Keith Group Headquarters Singapore 534101', contactNo: '+65 6488 2688', accountCodes: getImportAccountCodes('FASHION') },
  { code: 'IMP009', brands: ['USPA'],         name: 'SAAT VE SAAT SAN.VETİC.A.Ş.', nature: 'GOODS', address: 'Büyükdere Cad. Noramin İş Merkezi No:237/D Kat:B2 Maslak, İstanbul/Türkiye', contactNo: '+90 (212) 232 7 228', accountCodes: getImportAccountCodes('FASHION') },
  { code: 'IMP010', brands: ['DANISH DESIGN'], name: 'WEISZ GROUP',               nature: 'GOODS', address: 'Weisz Group Heijermanslaan 47A 1422 GV Uithoorn The Netherlands', contactNo: '+31 (0)20 679 46 33', accountCodes: getImportAccountCodes('FASHION') },
  { code: 'IMP011', brands: ['GUESS'],        name: 'PARAMOUNT ENTERPRISES PVT LTD.', nature: 'GOODS', address: '1 Dean Arcade Khy-Jami Block 8 Clifton Karachi Pakistan', accountCodes: getImportAccountCodes('FASHION') },

  // Watch Brands → 12010003
  { code: 'IMP012', brands: ['TAG HEUER'],    name: 'TAG HEUER',              nature: 'GOODS', address: 'Tag Heuer Branch of LVMH Swiss Manufactures SA Av. Luis-Joseph Chevrolet 4-6A CH-2300 La Chaux-de-Fond', accountCodes: getImportAccountCodes('WATCHES') },
  { code: 'IMP013', brands: ['TIMEX', 'NAUTICA'], name: 'TIMEX NEDERLAND B.V.',   nature: 'GOODS', address: 'TIMEX NEDERLAND B.V. TAURUSAVENUE 17A, 2132 LS HOOFDDORP, THE NETHERLANDS.', contactNo: '+31 23 556 3664', accountCodes: getImportAccountCodes('WATCHES') },
  { code: 'IMP014', brands: ['TIMBERLAND', 'POLICE'], name: 'ILG EMEA DWC LLC',       nature: 'GOODS', address: 'Plot No: WB27-WB28, Logistics District Dubai World Central, DUBAI, UNITED ARAB EMIRATES', contactNo: '+971 4 803 2222', accountCodes: getImportAccountCodes('WATCHES') },
  { code: 'IMP015', brands: ['TISSOT', 'RADO'], name: 'THE LEGEND',             nature: 'GOODS', address: '1-C Street 7A, Badar Commercial Area, DHA Ph V ext., Karachi.', contactNo: '021 35205108', accountCodes: getImportAccountCodes('WATCHES') },
];

const allVendors: VendorSeed[] = [...vendorsLocal, ...vendorsImport];

function decrypt(encryptedText: string, masterKeyString: string): string {
  const masterKey = Buffer.from(masterKeyString.slice(0, 32), 'utf-8');
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted text format');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(parts[2], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function seedVendors(prisma: PrismaClient) {
  console.log('  Resolving chart of account IDs...');

  const uniqueCodes = Array.from(new Set(allVendors.flatMap(v => v.accountCodes)));
  const accounts = await prisma.chartOfAccount.findMany({
    where: { code: { in: uniqueCodes } },
    select: { id: true, code: true },
  });
  const accountMap = new Map(accounts.map(a => [a.code, a.id]));

  for (const code of uniqueCodes) {
    if (!accountMap.has(code)) {
      console.warn(`  ⚠️  Chart of account not found for code: ${code} — run chart-of-account seed first`);
    }
  }

  let created = 0, updated = 0, skipped = 0;

  for (const v of allVendors) {
    const chartOfAccountIds = v.accountCodes
      .map(c => accountMap.get(c))
      .filter(Boolean) as string[];

    const existing = await (prisma as any).supplier?.findFirst?.({ where: { code: v.code } })
      ?? await (prisma as any).vendor?.findFirst?.({ where: { code: v.code } });

    let normalizedNature = v.nature as string;
    if (normalizedNature === 'GOODS / SERVICES' || normalizedNature === 'SERVICES/GOODS') {
      normalizedNature = 'GOODS';
    } else if (normalizedNature === 'RENT / SERVICES') {
      normalizedNature = 'SERVICES';
    } else if (!normalizedNature) {
      normalizedNature = 'SERVICES';
    }

    const brandDisplay = v.brands ? v.brands.join(' / ') : null;

    const data = {
      code: v.code,
      name: v.name,
      brand: brandDisplay,
      type: v.code.startsWith('IMP') ? 'IMPORT' : 'LOCAL',
      nature: normalizedNature,
      address: v.address || null,
      contactNo: v.contactNo || null,
      cnicNo: v.cnic || null,
      ntnNo: v.ntn || null,
      strnNo: v.strn || null,
      srbNo: v.srb || null,
      praNo: v.pra || null,
      ictNo: v.ict || null,
    };

    try {
      const model = (prisma as any).supplier ?? (prisma as any).vendor;
      if (!model) {
        console.error('  ❌ No supplier model found in Prisma client');
        break;
      }

      let supplierId = existing?.id;

      if (existing) {
        await model.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        const createdSupplier = await model.create({ data });
        supplierId = createdSupplier.id;
        created++;
      }

      if (supplierId && v.brands && v.brands.length > 0) {
        await (prisma as any).supplierBrand?.deleteMany?.({ where: { supplierId } });
        for (const brandName of v.brands) {
          const brandRecord = await (prisma as any).brand.findFirst({
            where: { name: { equals: brandName.trim(), mode: 'insensitive' } }
          });
          if (brandRecord) {
            await (prisma as any).supplierBrand?.create?.({
              data: { supplierId, brandId: brandRecord.id },
            });
          }
        }
      }
    } catch (err: any) {
      console.warn(`  ⚠️  Failed ${v.code}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`  ✅ Vendors: ${created} created, ${updated} updated, ${skipped} skipped`);
}

async function main() {
  console.log('🚀 Starting Vendor Seeding (Local & Import)...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT || process.env.MASTER_DATABASE_URL;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const singleDbUrl = process.env.DATABASE_URL;

  let processedTenantsCount = 0;

  if (managementUrl && masterKey) {
    console.log('📡 Connecting to Master DB to query active companies/tenants...');
    const pool = new Pool({ connectionString: managementUrl });
    const adapter = new PrismaPg(pool);
    const management = new ManagementClient({ adapter } as any);

    try {
      await management.$connect();
      let companies: any[] = [];
      try {
        companies = await management.company.findMany({ where: { status: 'active' } as any });
      } catch {
        try {
          companies = await (management as any).tenant.findMany({ where: { isDeleted: false } });
        } catch {
          companies = [];
        }
      }

      if (companies.length > 0) {
        console.log(`📡 Found ${companies.length} active company/tenant database(s). Seeding vendors...`);
        for (const company of companies) {
          const cCode = company.code || company.dbName || 'TENANT';
          const cName = company.name || company.code || 'Tenant';
          console.log(`\n👉 Seeding vendors for: ${cName} (${cCode})`);

          let connectionString = company.dbUrl;
          const rawPassword = company.dbPassword || company.dbPasswordEnc;
          const dbUser = company.dbUser || company.dbUsername;

          if (rawPassword) {
            try {
              const decPassword = encodeURIComponent(decrypt(rawPassword, masterKey));
              connectionString = `postgresql://${dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
            } catch {
              console.warn(`  ⚠️ Decryption failed, using stored dbUrl...`);
            }
          }

          if (!connectionString) {
            console.error(`  ❌ No connection details for ${cCode}`);
            continue;
          }

          try {
            const tenantPool = new Pool({ connectionString });
            const tenantAdapter = new PrismaPg(tenantPool);
            const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

            try {
              await tenantPrisma.$connect();
              await seedVendors(tenantPrisma);
              processedTenantsCount++;
            } finally {
              await tenantPrisma.$disconnect();
              await tenantPool.end();
            }
          } catch (err: any) {
            console.error(`  ❌ Failed processing tenant ${cCode}: ${err.message}`);
          }
        }
      }
    } finally {
      await management.$disconnect().catch(() => {});
      await pool.end().catch(() => {});
    }
  }

  if (processedTenantsCount === 0 && singleDbUrl) {
    console.log('📡 Running vendor seed in Single Database Mode (using DATABASE_URL)...');
    const tenantPool = new Pool({ connectionString: singleDbUrl });
    const tenantAdapter = new PrismaPg(tenantPool);
    const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

    try {
      await tenantPrisma.$connect();
      await seedVendors(tenantPrisma);
    } finally {
      await tenantPrisma.$disconnect();
      await tenantPool.end();
    }
  }

  console.log('\n✨ Vendor Seeding Complete.');
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
