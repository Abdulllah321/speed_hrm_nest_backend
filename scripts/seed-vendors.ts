import 'dotenv/config';
import { PrismaClient as ManagementClient } from '@prisma/management-client';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';

/**
 * ACCOUNT MAPPING LOGIC
 * ─────────────────────
 * Vendors link to Chart of Accounts via the payables section (Current Liabilities):
 *
 *  LOCAL VENDORS
 *  GOODS          → 12010004  BILLS PAYABLE-LOCAL
 *  SERVICES       → 12030001  A/P PARTIES
 *  RENT           → 12030001  A/P PARTIES  (rent accruals go here)
 *  GOODS/SERVICES → 12010004 + 12030001  (both accounts)
 *
 *  IMPORT VENDORS
 *  SPORTS BRANDS  → 12010001  BILLS PAYABLE-IMPORTS SPORTS BRANDS
 *  FASHION BRANDS → 12010002  BILLS PAYABLE-IMPORTS FASHION BRANDS
 *  WATCH BRANDS   → 12010003  BILLS PAYABLE-IMPORTS WATCH BRNDS
 *
 * The vendor codes (120001..., IMP001...) are the client's own reference numbers,
 * completely separate from chart of account codes (12010001 etc.)
 */

type VendorNature = 'GOODS' | 'SERVICES' | 'RENT' | 'GOODS / SERVICES';

interface VendorSeed {
  code: string;
  name: string;
  brand?: string;
  nature: VendorNature;
  address: string;
  contactNo?: string;
  cnic?: string;
  ntn?: string;
  strn?: string;
  srb?: string;
  pra?: string;
  ict?: string;
  /** Chart of account codes to link — resolved to IDs at runtime */
  accountCodes: string[];
}

function getAccountCodes(nature: VendorNature): string[] {
  switch (nature) {
    case 'GOODS':           return ['12010004'];
    case 'SERVICES':        return ['12030001'];
    case 'RENT':            return ['12030001'];
    case 'GOODS / SERVICES': return ['12010004', '12030001'];
    default:                return ['12030001'];
  }
}

const vendors: VendorSeed[] = [
  { code: '120001', name: 'EFU GENERAL INSURANCE CO. LTD.', nature: 'SERVICES', address: 'EFU HOUSE, M.A JINNAH ROAD, KARACHI', contactNo: '0300-8288838', ntn: '0944893-4', strn: 'Registered', srb: 'S0944893-4', pra: 'P0944893-4', accountCodes: getAccountCodes('SERVICES') },
  { code: '120002', name: 'KHAYABAN-E-IQBAL', nature: 'SERVICES', address: '123-124 THE FORUM G-20 BLOCK-9 CLIFTON, KARACHI', contactNo: '021-35831275', ntn: '0816951-9', strn: '1200842800864', accountCodes: getAccountCodes('SERVICES') },
  { code: '120003', name: 'PTCL', nature: 'SERVICES', address: 'PTCL Head Office, Ufone Tower, F-7/1, Blue Area, Islamabad', contactNo: '0308 2894101', ntn: '0801599-6', strn: '0701851701346', srb: 'S0801599-6', pra: 'P0801599-6', accountCodes: getAccountCodes('SERVICES') },
  { code: '120004', name: 'AL FEROZ (PVT) LTD.', nature: 'SERVICES', address: 'C-36-I, Defence Commercial Market D.H.A., Karachi', contactNo: '021-34534454', ntn: '1019774-5', strn: 'Registered', srb: 'S1019774-5', accountCodes: getAccountCodes('SERVICES') },
  { code: '120005', name: 'PAK MOBILE COMMUNICATION', nature: 'SERVICES', address: '1-A, IBC BUILDING F-8 MARKAZ, Islamabad', contactNo: '9221-5670267', ntn: '0802694-7', strn: 'Registered', srb: 'S0802694-7', pra: 'P0802694-7', accountCodes: getAccountCodes('SERVICES') },
  { code: '120006', name: 'NADEEM SHAHZAD', nature: 'SERVICES', address: '94-C-2 Gulberg III, Lahore', contactNo: '042-111786240', cnic: '38403-2204729-1', ntn: '1546691-4', strn: 'Registered', accountCodes: getAccountCodes('SERVICES') },
  { code: '120007', name: 'VISAGE', nature: 'SERVICES', address: '16 MALL SQUARE ZAMZAM BLOCK V ARD P-5 DHA, KARACHI', contactNo: '021-35861787', cnic: '42301-9850791-6', ntn: '0292227-4', accountCodes: getAccountCodes('SERVICES') },
  { code: '120008', name: 'AL NASIR TRANSPORT SERVICE', nature: 'SERVICES', address: 'X-394, STREET NO 9, HILL AREA, CHANESAR GOTH, KARACHI', contactNo: '0345-2193299', cnic: '42000-2342058-3', ntn: '5235515-8', srb: 'S5235515-8', accountCodes: getAccountCodes('SERVICES') },
  { code: '120009', name: 'SIGN TECHNICAL SERVICES', nature: 'GOODS / SERVICES', address: 'PLOT NO. 06, STREET-15, SECTOR-33/F, KORANGI NO-02, KARACHI', contactNo: '0300-0303648', cnic: '42201-2887679-4', ntn: '3531546-6', accountCodes: getAccountCodes('GOODS / SERVICES') },
  { code: '120010', name: 'QUALITY AVIATION (PVT.) LTD.', nature: 'SERVICES', address: '123-124 THE FORUM G-20 BLOCK-9 CLIFTON', contactNo: '021-35831275', ntn: '1019083-0', srb: 'S1019083-0', accountCodes: getAccountCodes('SERVICES') },
  { code: '120011', name: 'LEOPARDS COURIER SERVICES', nature: 'SERVICES', address: '46-E, E-MARKET, BLOCK-6, P.E.C.H.S., KARACHI', contactNo: '0345-2007712', ntn: '2824502-4', strn: '1200980800191', srb: 'S2824502-4', pra: 'P2824502-4', accountCodes: getAccountCodes('SERVICES') },
  { code: '120012', name: 'THE WOODPECKER', nature: 'GOODS', address: 'Off# 2, 1st Floor, 3 Sister Lodge, Plote# 3/3, Commercial Area Bahadurabad, Karachi', contactNo: '021-38165643', cnic: '42201-8491399-0', ntn: '7269290-8', srb: 'S7269290-8', accountCodes: getAccountCodes('GOODS') },
  { code: '120013', name: 'FOUNTAIN AVENUE', nature: 'SERVICES', address: 'H No 64 Main Gulberg, Lahore', contactNo: '0300-8416198', cnic: '35202-7393725-5', ntn: '1676773-0', accountCodes: getAccountCodes('SERVICES') },
  { code: '120014', name: 'JOHAN (PVT) LTD.', nature: 'GOODS', address: 'F-17/A, Hub River Road, S.I.T.E, Karachi-75700', contactNo: '0321-2598502', ntn: '0814904-6', strn: '1100220100346', srb: 'S0814904-6', accountCodes: getAccountCodes('GOODS') },
  { code: '120015', name: 'A2Z CREATORZ', nature: 'SERVICES', address: 'BUILDING NO. 64-C, 2ND FLOOR, 21ST COMMERCIAL STREET, PHASE-II, EXTN. D.H.A., Karachi', contactNo: '021-35385205', cnic: '42201-0139906-1', ntn: '2922455-1', srb: 'S2922455-1', accountCodes: getAccountCodes('SERVICES') },
  { code: '120016', name: 'FALCON-I (PVT) LIMITED', nature: 'SERVICES', address: '50-A/3 STREET # 2 GULSHAN-E-FAISAL BATH ISLAND, KARACHI', contactNo: '0347-2223232', ntn: '2868087-1', strn: 'Registered', srb: 'S2868087-1', pra: 'P2868087-1', accountCodes: getAccountCodes('SERVICES') },
  { code: '120017', name: 'TPL TRAKKER LIMITED', nature: 'SERVICES', address: '39-K PECHS BLOCK 6, Karachi', contactNo: '0301-8283394', ntn: '3269849-6', strn: 'Registered', srb: 'S3269849-6', pra: 'P3269849-6', accountCodes: getAccountCodes('SERVICES') },
  { code: '120018', name: 'MULTINET PAKISTAN (PVT.) LIMITED', nature: 'SERVICES', address: '1D-203, SECTOR#30, KORANGI INDUSTRIAL AREA, KARACHI', contactNo: '111-021-021', ntn: '1205953-6', strn: '1712981200973', srb: 'S1205953-6', pra: 'P1205953-6', accountCodes: getAccountCodes('SERVICES') },
  { code: '120019', name: 'MOHSIN TAYEBALY', nature: 'SERVICES', address: '2nd Floor Dime Centre BC-4 Block 9 Kehkashan Clifton, Karachi', contactNo: '021-325375659', ntn: '2268154-0', accountCodes: getAccountCodes('SERVICES') },
  { code: '120020', name: 'MEHRAN SERVICES', nature: 'GOODS', address: 'ROOM #216-A, 2ND FLOOR SUNNY PLAZA HASRAT MOHANI ROAD, KARACHI', contactNo: '0335-2349257', cnic: '42101-1369866-3', ntn: '2399690-7', accountCodes: getAccountCodes('GOODS') },
  { code: '120021', name: 'PRINCELY TRAVELS', nature: 'SERVICES', address: '14/15/16 Service club merewether road karachi', contactNo: '021-35211081', ntn: '1019158-5', srb: 'S1019158-5', accountCodes: getAccountCodes('SERVICES') },
  { code: '120022', name: 'WASA', nature: 'SERVICES', address: 'Water reservoir, Shah Jamal Colony, Lahore', contactNo: '042-99205581', accountCodes: getAccountCodes('SERVICES') },
  { code: '120023', name: 'KUN ADVERTISING AGENCY', nature: 'SERVICES', address: 'A-79, 1st Floor Sasi Arcade Block-7 Clifton Karachi', contactNo: '0321-2426575', cnic: '42201-0812648-3', ntn: '1037442-6', accountCodes: getAccountCodes('SERVICES') },
  { code: '120024', name: 'PRIME BUSINESS SYSTEMS', nature: 'GOODS', address: 'ROOM NO. 4-5, AMBER MOTEL, 51-H-1, BLOCK-6, P.E.C.H.S., KARACHI', contactNo: '021-34546481', cnic: '42101-1628774-5', ntn: '2441897-8', srb: 'S2441897-8', accountCodes: getAccountCodes('GOODS') },
  { code: '120025', name: 'MAINETT PAKISTAN (PVT.) LTD.', nature: 'GOODS', address: 'PLOT NO., 1-C, 2nd FLOOR, LANE NO.6, BOKHARI COMMERCIAL AREA PHASE-VI, DHA KARACHI', contactNo: '021-32427332', ntn: '2277371-1', strn: 'Registered', srb: 'S2277371-1', accountCodes: getAccountCodes('GOODS') },
  { code: '120026', name: 'NASEER AUTOS', nature: 'GOODS / SERVICES', address: 'PLOT NO D-55 A/1-MAIN ESTATE AVENUE S.I.T.E., KARACHI', contactNo: '021-32573266', ntn: '0855892-2', strn: '1200870310491', srb: 'S0855892-2', accountCodes: getAccountCodes('GOODS / SERVICES') },
  { code: '120027', name: 'PAPER MAGAZINE', nature: 'SERVICES', address: 'Office# 409, 410, 4th floor, D/1, Gulberg III, Lahore', contactNo: '0331-4817734', ntn: '8973367-7', accountCodes: getAccountCodes('SERVICES') },
  { code: '120028', name: 'NEW JUBILEE LIFE INSURANCE CO.', nature: 'SERVICES', address: '74-1-A, LALAZAR M.T KHAN ROAD, KARACHI', contactNo: '021-35205095', ntn: '0660564-8', srb: 'S0660564-8', pra: 'P0660564-8', accountCodes: getAccountCodes('SERVICES') },
  { code: '120029', name: 'WATCHMAN SECURITY SYSTEM', nature: 'SERVICES', address: 'Flat No.01, Block No. 91, Street No. 34, I&T Centre G-10/1, ISLAMABAD', contactNo: '0302-2429338', ntn: '3013365-3', strn: '3277876120336', srb: 'S3013365-3', pra: 'P3013365-3', accountCodes: getAccountCodes('SERVICES') },
  { code: '120030', name: 'NICHE LIFE STYLE', nature: 'SERVICES', address: 'Office No. 125, 2nd Floor, Park Lane Tower, 172-Tufail Road, Lahore', contactNo: '0345-4066553', ntn: '6280499-2', pra: 'P6280499-2', accountCodes: getAccountCodes('SERVICES') },
  { code: '120031', name: 'DOLMEN (PVT.) LTD.', nature: 'SERVICES', address: '18/C, Block-7/8, Shaheed-E-Millat Karachi', contactNo: '021-34321120', ntn: '0710245-3', strn: 'Registered', srb: 'S0710245-3', accountCodes: getAccountCodes('SERVICES') },
  { code: '120032', name: 'PEARL BUTTON MFG CO.', nature: 'RENT', address: 'PLOT NO.1-6/12, SECTOR-5, KORANGI INDUSTRIAL AREA, KARACHI', contactNo: '0300-2534436', ntn: '0859655-7', accountCodes: getAccountCodes('RENT') },
  { code: '120033', name: 'UNIVERSAL LOGISTICS SERVICES (PVT.) LTD.', nature: 'SERVICES', address: '12 BAHADURABAD, MAIN SHAHEED-E-MILLAT ROAD, KARACHI', contactNo: '021-35148127', ntn: '1343872-7', strn: 'Registered', srb: 'S1343872-7', pra: 'P1343872-7', accountCodes: getAccountCodes('SERVICES') },
  { code: '120034', name: 'PRINCELY JETS (PVT) LIMITED', nature: 'SERVICES', address: 'Merewether Rd, Civil Lines, Karachi', contactNo: '021 35674230', accountCodes: getAccountCodes('SERVICES') },
  { code: '120035', name: 'SAIF PUBLISHING (PVT.) LTD.', nature: 'SERVICES', address: 'OFFICE NO. 7, 4TH FLOOR, KALSOOM PLAZA, BLUE AREA, ISLAMABAD', contactNo: '021-32623961', ntn: '3926343-6', strn: '2600392634313', accountCodes: getAccountCodes('SERVICES') },
  { code: '120036', name: 'SERVICES MESS KARACHI', nature: 'GOODS', address: 'Merewether Rd, Civil Lines, Karachi City, Sindh 75520', contactNo: '021-99201904', accountCodes: getAccountCodes('GOODS') },
  { code: '120037', name: 'ELEGANT PACKAGES', nature: 'GOODS', address: 'PLOT NO.C-28, SECTOR 32/A, KARACHI', contactNo: '0331-9271525', cnic: '35200-1529528-3', ntn: '3413571-5', accountCodes: getAccountCodes('GOODS') },
  { code: '120038', name: 'ASIF ENTERPRISES', nature: 'GOODS', address: 'C-55 BLOCK 6 FEDERAL B.AREA, KARACHI', cnic: '42101-1792122-9', ntn: '1289204-1', accountCodes: getAccountCodes('GOODS') },
  { code: '120039', name: 'JILANI FLEXIBLE PACKAGES (PVT.) LTD.', nature: 'GOODS', address: 'F-312 S.I.T.E Karachi', contactNo: '021-32582679', ntn: '3094560-7', strn: '1700392300582', accountCodes: getAccountCodes('GOODS') },
  { code: '120040', name: 'TCS (PRIVATE) LIMITED', nature: 'SERVICES', address: '101-104, Civil Aviation Club Road, Karachi 75202', contactNo: '021-9242913', accountCodes: getAccountCodes('SERVICES') },
  { code: '120041', name: 'AKBAR ENTERPRISES (PVT.) LIMITED', nature: 'SERVICES', address: '#1 1ST FLOOR SERVICE CLUB EXT BUILDING MEREWEATHER ROAD, KARACHI', contactNo: '021-35660317', ntn: '1154710-3', strn: '1600980300282', accountCodes: getAccountCodes('SERVICES') },
  { code: '120042', name: 'ZAMAN TRANSPORT SERVICES', nature: 'SERVICES', address: 'PLOT NO.74/B, NEW SINDHI MUSLIM COLONY, BLOCK-6, PECHS, KARACHI', contactNo: '0311-2002910', cnic: '42201-0353470-5', ntn: '4036915-3', srb: 'S4036915-3', accountCodes: getAccountCodes('SERVICES') },
  { code: '120043', name: 'S.M. REHAN & CO.', nature: 'SERVICES', address: '5TH FL SPOTLIT CHAMBERS, KARACHI', contactNo: '021-35653677', cnic: '42101-9288745-5', ntn: '0788218-1', srb: 'S0788218-1', accountCodes: getAccountCodes('SERVICES') },
  { code: '120044', name: 'PAK SUZUKI MOTOR CO. LTD.', nature: 'GOODS / SERVICES', address: 'DSU-13, PAKISTAN STEEL INDUSTRIAL ESTATE, BIN QASIM, KARACHI', ntn: '0712837-1', strn: '0214870300137', srb: 'S0712837-1', pra: 'P0712837-1', accountCodes: getAccountCodes('GOODS / SERVICES') },
  { code: '120045', name: 'PAK GULF CONSTRUCTION (PVT.) LTD.', nature: 'SERVICES', address: 'HOUSE NO. 176 GOMAL ROAD SECTOR E-7, ISLAMABAD', contactNo: '051-8483010', ntn: '2494327-4', strn: 'Registered', ict: '2494327-4', accountCodes: getAccountCodes('SERVICES') },
  { code: '120046', name: 'AL-SAFA GOLDEN CO (PVT.) LTD.', nature: 'RENT', address: '5-A, JINNAH SUPER MARKET, F-7 MARKAZ, ISLAMABAD', contactNo: '051-2656764', ntn: '3911771-5', accountCodes: getAccountCodes('RENT') },
  { code: '120047', name: 'SAFA GOLD MALL', nature: 'SERVICES', address: 'OFFICE, PLOT NO.5-A, JINNAH SUPER MARKET, F 7 MARKAZ, ISLAMABAD', contactNo: '051-2656764', cnic: '33106-4609456-2', ntn: '2491985-3', accountCodes: getAccountCodes('SERVICES') },
  { code: '120048', name: 'NISHAT HOTELS AND PROPERTIES LIMITED', nature: 'RENT', address: '1-B, AZIZ AVENUE, CANAL BANK, GULBERG-V, LAHORE CITY', contactNo: '042-32592114', ntn: '3033263-0', strn: '0303980103946', pra: 'P3033263-0', accountCodes: getAccountCodes('RENT') },
  { code: '120049', name: 'CROWN TRAVELS', nature: 'SERVICES', address: 'ROOM NO.1, 1ST FLOOR SERVICES CLUB EXT, BUILDING MEREWEATHER ROAD, KARACHI', contactNo: '021-35660330', ntn: '3199827-5', strn: '1700319982712', accountCodes: getAccountCodes('SERVICES') },
  { code: '120050', name: 'ARSHAD MUNIR SUPPLY & SERVICES', nature: 'GOODS', address: 'SECTOR 1-A, LINES AREA, SADDAR TOWN, KARACHI', contactNo: '0300-8278849', cnic: '31303-7861272-8', ntn: '4245001-2', accountCodes: getAccountCodes('GOODS') }
];

// Vendors 51-100
const vendors2: VendorSeed[] = [
  { code: '120051', name: 'KW&SB', nature: 'SERVICES', address: '9th Mile Karsaz, Main Shahrah-e-Faisal, Karachi-75350', contactNo: '021-111597200', accountCodes: getAccountCodes('SERVICES') },
  { code: '120052', name: 'FAZAL-E-RABBI (PVT.) LTD.', nature: 'SERVICES', address: 'G-4/A & B, Court Road, Opp: Sindh Assembly Building, Karachi', contactNo: '0321-3899199', ntn: '0708850-7', srb: 'S0708850-7', accountCodes: getAccountCodes('SERVICES') },
  { code: '120053', name: 'Dolmen Real Estate Management (Pvt.) Ltd.', nature: 'SERVICES', address: '17TH FLOOR, THE HARBOUR FRONT HC-3 BLOCK 4, DOLMEN CITY, CLIFTON ROAD, KARACHI', contactNo: '0311-3622974', ntn: '4386954-8', strn: 'Registered', srb: 'S4386954-8', pra: 'P4386954-8', accountCodes: getAccountCodes('SERVICES') },
  { code: '120054', name: 'CDC-TRUSTEE DOLMEN CITY REIT', nature: 'RENT', address: 'ARIF HABIB CENTRE, 23 M.T.KHAN ROAD, KARACHI', contactNo: '021-35296192', ntn: '4360482-0', strn: 'Registered', srb: 'S4360482-0', accountCodes: getAccountCodes('RENT') },
  { code: '120055', name: 'INDUS MOTOR CO. LTD.', nature: 'GOODS', address: 'Plot No. N.W.Z/1/P-1, Port Qasim Authority, Karachi', contactNo: '021-34532246', ntn: '0676546-7', strn: '0204870300155', srb: 'S0676546-7', accountCodes: getAccountCodes('GOODS') },
  { code: '120056', name: 'TOYOTA CENTRAL MOTORS', nature: 'GOODS / SERVICES', address: '3, MAIN SHAHRAH-E-FAISAL, KARACHI', contactNo: '0346-8222370', cnic: '42201-9097527-7', ntn: '1055945-7', strn: '1221999922337', srb: 'S1055945-7', accountCodes: getAccountCodes('GOODS / SERVICES') },
  { code: '120057', name: 'PREMIER AVIATION SERVICES (PVT.) LTD.', nature: 'SERVICES', address: '2ND FLOOR, SERVICES EXTENSION BUILDING, MEREWETHER ROAD, SADDAR TOWN, KARACHI', contactNo: '021-35674684', ntn: '0999489-7', accountCodes: getAccountCodes('SERVICES') },
  { code: '120058', name: 'AL GHURAIR GIGA PAKISTAN (PVT.) LTD.', nature: 'RENT', address: 'DHA Phase-II, Sheikh Zaid Bin Alnahyan Road, ISLAMABAD', contactNo: '051-8491040', ntn: '2257464-6', strn: '2601681000146', srb: 'S2257464-6', pra: 'P2257464-6', accountCodes: getAccountCodes('RENT') },
  { code: '120059', name: 'EFU GENERAL - MARINE CARGO IMPORT', nature: 'SERVICES', address: 'EFU HOUSE, M.A JINNAH ROAD, KARACHI', contactNo: '0300-8288838', accountCodes: getAccountCodes('SERVICES') },
  { code: '120060', name: 'AMRELIWALA MOTORS (PVT.) LTD.', nature: 'GOODS / SERVICES', address: 'PLOT NO C-1, SITE, MANGHOPIR ROAD, Karachi West Site Town', contactNo: '021-32570301', ntn: '0704028-8', strn: '1102999947619', srb: 'S0704028-8', accountCodes: getAccountCodes('GOODS / SERVICES') },
  { code: '120061', name: 'EOBI', nature: 'SERVICES', address: 'Third Floor (EOBI HOUSE) Awami Markaz, Main Shahrah-e-Faisal, Karachi', contactNo: '021-99244491', accountCodes: getAccountCodes('SERVICES') },
  { code: '120062', name: 'INTELLEXAL SOLUTIONS (PVT.) LTD.', nature: 'SERVICES', address: 'PLOT 12/J/6, P E C H S, OFFICE#107 FIRST FLOOR, KARACHI', contactNo: '021-34331234', ntn: '4140461-7', strn: 'Registered', srb: 'S4140461-7', accountCodes: getAccountCodes('SERVICES') },
  { code: '120063', name: 'DHL PAKISTAN (PVT.) LTD.', nature: 'SERVICES', address: '22 BANGLORE TOWN MAIN SHAHRAH-E-FAISAL, KARACHI', contactNo: '111-345-111', ntn: '0816259-0', strn: '1200980800437', srb: 'S0816259-0', pra: 'P0816259-0', accountCodes: getAccountCodes('SERVICES') },
  { code: '120064', name: 'SIGN TECHNICAL SERVICES (FBR)', nature: 'GOODS / SERVICES', address: 'PLOT NO.8 STREET NO.15 SECTOR 33/F KORANGI NO.2, KARACHI', contactNo: '0300-0303648', cnic: '42201-1870411-5', ntn: '2263257-3', strn: '1700980200937', srb: 'S2263257-3', accountCodes: getAccountCodes('GOODS / SERVICES') },
  { code: '120065', name: 'EBCO (PVT.) LIMITED', nature: 'SERVICES', address: 'SUITE NO. 123-124 THE FORUM G-20 BLOCK-9 KHAYABAN-E-JAMI CLIFTON', contactNo: '021-3561660', ntn: '7266041-8', srb: 'S7266041-8', accountCodes: getAccountCodes('SERVICES') },
  { code: '120066', name: 'LUCKY LANDMARK (PVT.) LTD.', nature: 'RENT', address: 'L-A, 2/B, BLOCK-21, FEDERAL-B-AREA, Gulberg Town, KARACHI CENTRAL', contactNo: '021-36321311', ntn: '4353381-7', strn: '3277876135568', srb: 'S4353381-7', accountCodes: getAccountCodes('RENT') },
  { code: '120067', name: 'IMPERIAL FACILITY MANAGEMENT (PVT.) LTD.', nature: 'SERVICES', address: 'Office No 08, DHA Phase-II, Gate-II, Main G.T Road, ISLAMABAD', contactNo: '051-8491040', ntn: '7235181-0', strn: '3277876128970', accountCodes: getAccountCodes('SERVICES') },
  { code: '120068', name: 'SUZUKI MACCA MOTORS', nature: 'GOODS / SERVICES', address: 'FL-8-9-10-11, GULSHAN-E-JAMAL, RASHID MINHAS ROAD, OPP.C.O.D., KARACHI', cnic: '42301-0609454-8', ntn: '3816182-6', strn: '1700381618215', srb: 'S3816182-6', accountCodes: getAccountCodes('GOODS / SERVICES') },
  { code: '120069', name: 'AL BARKA WATER', nature: 'GOODS', address: '51/C, SATELLITE TOWN, SARGODHA', contactNo: '0300-6042416', ntn: '2503648-3', strn: '2400250364813', accountCodes: getAccountCodes('GOODS') },
  { code: '120070', name: 'IBL OPERATION (PVT.) LTD.', nature: 'GOODS', address: '9TH FLOOR, NIC BUILDING, ABBASI SHAHEED ROAD, SHARA E FAISAL, KARACHI', ntn: '3676651-8', strn: '1700367665115', srb: 'S3676651-8', accountCodes: getAccountCodes('GOODS') },
  { code: '120071', name: 'BRANDANIA ADGOS', nature: 'GOODS', address: 'OFFICE#290-B, MAIN MKT OPP REGENT HOTEL, COMMITTEE CHOWK, RAWALPINDI', contactNo: '0310-5445214', cnic: '37101-1800344-1', ntn: '3527787-4', strn: '2300352778712', pra: 'P3527787-4', accountCodes: getAccountCodes('GOODS') },
  { code: '120072', name: 'CYBER INTERNET SERVICES (PVT.) LIMITED', nature: 'SERVICES', address: 'A-904 9TH FLOOR LAKSON SQUARE SARWAR SHAHEED ROAD, KARACHI', contactNo: '111-178-676', ntn: '0660563-0', strn: '1200851700628', srb: 'S0660563-0', pra: 'P0660563-0', accountCodes: getAccountCodes('SERVICES') },
  { code: '120073', name: 'PEOPLE MAGAZINE PAKISTAN', nature: 'SERVICES', address: '20-D, COMMERCIAL A MARKET, PHASE-2, DHA, Karachi South Saddar Town', contactNo: '021-35311781', cnic: '42301-1493637-9', ntn: '2537197-5', accountCodes: getAccountCodes('SERVICES') },
  { code: '120074', name: 'PULSE INTERNATIONAL', nature: 'GOODS', address: 'B-162, BLOCK W, ALLAMA IQBAL TOWN, NORTH NAZIMABAD, KARACHI CENTRAL', contactNo: '0332-2331400', ntn: '7285480-7', accountCodes: getAccountCodes('GOODS') },
  { code: '120075', name: 'AAM DEVELOPERS (PVT.) LTD.', nature: 'RENT', address: 'NEAR TOYOTA MULTAN BUILDING, BOSAN ROAD, SHALIMAR COLONY, Multan Cantt', contactNo: '061-4424292', ntn: '4245339-9', strn: 'Registered', pra: 'P4245339-9', accountCodes: getAccountCodes('RENT') },
  { code: '120076', name: 'PREMIER DEVELOPERS', nature: 'RENT', address: '44A, SAEED COLONY, CANAL ROAD, Faisalabad Madina Town', contactNo: '041-2421446', cnic: '17201-5823478-5', ntn: '0207010-3', strn: 'Registered', pra: 'P0207010-3', accountCodes: getAccountCodes('RENT') },
  { code: '120077', name: 'SAFA MANAGEMENT SERVICES', nature: 'SERVICES', address: 'PLOT NO 16, MAIN DOUBLE ROAD, F-11/1, ISLAMABAD', contactNo: '051-2656766', ntn: '7955042-5', strn: 'Registered', accountCodes: getAccountCodes('SERVICES') },
  { code: '120078', name: 'CYBER SOFTWARE', nature: 'SERVICES', address: '603, Westland Trade Centre, Block 7 & 8, KCHS, Shaheed-e-Millat Road Karachi', contactNo: '0300-9242736', cnic: '42000-0484845-1', ntn: '0518139-9', srb: 'S0518139-9', accountCodes: getAccountCodes('SERVICES') },
  { code: '120079', name: 'BAHRIA TOWN (PVT.) LTD.', nature: 'SERVICES', address: 'Super Highway, Bahria Town Karachi', contactNo: '0800 00100', accountCodes: getAccountCodes('SERVICES') },
  { code: '120080', name: 'KINETIC BUSINESS SOLUTIONS', nature: 'SERVICES', address: 'Plot # 27, Sector No 15, Korangi Industrial Area, Korangi Town', contactNo: '0317-2298929', ntn: '4395126-7', strn: '3277876220786', srb: 'S4395126-7', pra: 'P4395126-7', accountCodes: getAccountCodes('SERVICES') },
  { code: '120081', name: 'PACKAGES REAL ESTATE (PVT.) LTD.', nature: 'RENT', address: 'SHAHRAH-E-ROOMI, P.O AMER SIDHU, LAHORE CANTT', contactNo: '042-35811541', ntn: '2606088-4', strn: '0302681001682', srb: 'S2606088-4', pra: 'P2606088-4', accountCodes: getAccountCodes('RENT') },
  { code: '120082', name: 'ALI RAZA', nature: 'RENT', address: 'H. No.F-788, SATELLITE TOWN, RAWALPINDI', contactNo: '051-8491040', cnic: '37405-0642287-7', ntn: '2389926-3', accountCodes: getAccountCodes('RENT') },
  { code: '120083', name: 'Quality Construction (Pvt.) Limited', nature: 'SERVICES', address: '123-124 THE FORUM G-20 BLOCK-9 KHAYABAN-E-JAMI CLIFTON', contactNo: '021-35831275', ntn: '1019083-0', srb: 'S1019083-0', accountCodes: getAccountCodes('SERVICES') },
  { code: '120084', name: 'THE TIMES PRESS (PRIVATE) LIMITED', nature: 'GOODS', address: 'C-18, Al-Hilal Society, Off University Road, Karachi East Gulshan Town', contactNo: '021-34932931', ntn: '0712417-1', strn: '0215844200837', accountCodes: getAccountCodes('GOODS') },
  { code: '120085', name: 'GRAPHEME STUDIO', nature: 'GOODS', address: 'PLOT # 927/928, SUIT # 202, AL-MUSTAFA CENTER, BLOCK-2 P.E.C.H.S. TARIQ ROAD, KARACHI', contactNo: '0345-2744507', cnic: '42101-3219198-9', ntn: '3795544-6', accountCodes: getAccountCodes('GOODS') },
  { code: '120086', name: 'LESCO', nature: 'SERVICES', address: 'LESCO Head Quarter, 22-A Queens Road Lahore', contactNo: '042-99205248', accountCodes: getAccountCodes('SERVICES') },
  { code: '120087', name: 'K-ELECTRIC', nature: 'SERVICES', address: 'KE House, 39-B, Sunset Boulevard, Phase-II, Defence Housing Authority, Karachi', contactNo: '021-3263 7133', accountCodes: getAccountCodes('SERVICES') },
  { code: '120088', name: 'INDUS FUMIGATION', nature: 'SERVICES', address: 'R-346, Sector 8-B, Abbysina Line, Shahrah-e-Faisal, Saddar Town, KARACHI SOUTH', contactNo: '021-32784960', cnic: '42101-5682932-8', ntn: '4205960-7', srb: 'S4205960-7', accountCodes: getAccountCodes('SERVICES') },
  { code: '120089', name: 'AM INNOVATION', nature: 'GOODS', address: 'Suit No16-B, Zulljalal Center Main, Tariq Road, Karachi East Jamshed Town', contactNo: '0332-3486174', cnic: '42201-4308810-5', ntn: '7123929-6', accountCodes: getAccountCodes('GOODS') },
  { code: '120090', name: 'AQUA BLISS', nature: 'GOODS', address: 'House# 697-L, Sector 5 A 3, Gulshan Liaquat, North Karachi', contactNo: '0301-2800371', cnic: '42101-4378357-3', accountCodes: getAccountCodes('GOODS') },
  { code: '120091', name: 'MONTHLY BRANDS', nature: 'SERVICES', address: '20-D, COMMERCIAL A MARKET, PHASE-2, DHA, Karachi South Saddar Town', contactNo: '0321-9039871', cnic: '42301-1493637-9', ntn: '2537197-5', accountCodes: getAccountCodes('SERVICES') },
  { code: '120092', name: 'SOUTHERN PEARL INTERNATIONAL SERVICES (PVT.) LTD.', nature: 'GOODS', address: 'HOUSE NO,1, ST NO,17 D BLOCK F, NAVAL ANCHORAGE IBD, Islamabad Rural', contactNo: '033-111-110-52', cnic: '32778-7614968-6', ntn: '8905555-1', strn: 'Registered', accountCodes: getAccountCodes('GOODS') },
  { code: '120093', name: 'WONDER ADVERTISER AND ENGG SERVICES', nature: 'GOODS', address: 'PLOT NO-4 SECTOR 33-F ST-14 NEAR VITA CHOWRANGI, KARACHI', cnic: '42201-4959175-1', ntn: '2926963-6', strn: '1701999901946', srb: 'S2926963-6', accountCodes: getAccountCodes('GOODS') },
  { code: '120094', name: 'BIG EYE', nature: 'GOODS', address: 'IST FLOOR, PLOT NO.8, BLOCK B1, MAIN BOULEVARD, NEAR HAKIM CHOWK, PIA HOUSING SOCIETY, LAHORE', contactNo: '0345-4054484', ntn: '7992643-4', strn: '3277876157781', accountCodes: getAccountCodes('GOODS') },
  { code: '120095', name: 'THE LEGEND', nature: 'GOODS', address: 'PLOT NO 1-C, STREET 7A, BADAR COMMERCIAL, PHASE-V EXT DHA, Karachi South Saddar Town', contactNo: '021-33411654', ntn: '1558685-5', strn: '1200910000146', accountCodes: getAccountCodes('GOODS') },
  { code: '120096', name: 'AXLE AND OLIO SOLUTIONS PAKISTAN (PVT.) LTD.', nature: 'SERVICES', address: '111/4, STREET 26, OFF: KHAYABAN-E-KHALID, D.H.A., PHASE - VIII, Pakistan', contactNo: '0343-3016460', ntn: '8243861-5', srb: 'S8243861-5', accountCodes: getAccountCodes('SERVICES') },
  { code: '120097', name: 'FAWAD ASGHAR', nature: 'RENT', address: 'P-3 RAZA TOWN CANAL ROAD, Faisalabad', contactNo: '0344-6600661', cnic: '33100-1216001-7', ntn: '2868652-7', accountCodes: getAccountCodes('RENT') },
  { code: '120098', name: 'ROBINA KAUSAR', nature: 'RENT', address: '27 - PARADISE VALLEY, STREET MASJAD WALI, SHEIKHUPURA ROAD, Faisalabad Madina Town', contactNo: '0344-6600661', cnic: '33104-7369214-2', ntn: '5114135-2', accountCodes: getAccountCodes('RENT') },
  { code: '120099', name: 'KINGSON - REAL ESTATE', nature: 'RENT', address: '1, SHOP NO. SB-05/12 (KINGSON INTERNATIONAL) KARACHI', contactNo: '0333-2142387', cnic: '42201-0523274-0', ntn: '2261715-9', strn: 'Registered', accountCodes: getAccountCodes('RENT') },
  { code: '120100', name: 'NETSAT (PRIVATE) LIMITED', nature: 'SERVICES', address: 'Plot No. 87/10 Sector 5, BEH DIH, Tappo Ibrahim Hyderi, Korangi Industrial Area, Karachi', contactNo: '0301-8114160', ntn: '2792898-5', strn: '1750999934128', srb: 'S2792898-5', pra: 'P2792898-5', accountCodes: getAccountCodes('SERVICES') }
];

// Vendors 101-150
const vendors3: VendorSeed[] = [
  { code: '120101', name: 'ELAHEE BUKSH & COMPANY (PVT.) LTD.', nature: 'RENT', address: '123-124, THE FORUM, G 20, BLOCK - IX, CLIFTON, Karachi South Saddar Town', ntn: '1875164-4', strn: 'Registered', accountCodes: getAccountCodes('RENT') },
  { code: '120102', name: 'AERO PACKAGES', nature: 'GOODS', address: 'SHOP No.4, HUSSAIN ARCADE, BURNS ROAD, STREET No.10, Karachi South', contactNo: '0300-8248796', cnic: '42201-0484403-0', ntn: '8171362-1', strn: '3277876198441', accountCodes: getAccountCodes('GOODS') },
  { code: '120103', name: 'MUHAMMAD AWAIS', nature: 'RENT', address: 'P-413, TARIQABAD, Faisalabad Lyallpur Town', contactNo: '0344-6600661', cnic: '33100-9539511-9', ntn: '7565049-0', accountCodes: getAccountCodes('RENT') },
  { code: '120104', name: 'AHSAN ABBAS KAZMI', nature: 'RENT', address: 'KARACHI', cnic: '37405-8100673-3', ntn: '3720613-3', accountCodes: getAccountCodes('RENT') },
  { code: '120105', name: 'RAMNA PREMIUM DRINKING WATER', nature: 'GOODS', address: 'RAMNA HOUSE 63A/2 ABU BAKAR BLOCK, NEW GARDEN TOWN, LAHORE', contactNo: '0322-4990249', cnic: '35202-6767230-1', ntn: '3402355-7', accountCodes: getAccountCodes('GOODS') },
  { code: '120106', name: 'INTERNATIONAL WATCH COMPANY', nature: 'GOODS', address: 'SHOP NO-4 LAKSHMI BUILDING GROUND FLOOR M.A.JINNAH ROAD', contactNo: '042-35871370', cnic: '42201-0523274-0', ntn: '2261715-9', strn: 'Registered', accountCodes: getAccountCodes('GOODS') },
  { code: '120107', name: 'PARAMOUNT ENTERPRISES (PVT.) LTD.', nature: 'GOODS', address: '1ST FLOOR DEAN ARCADE BLOCK -8 CLIFTON', contactNo: '021-35837447', ntn: '1548234-7', strn: 'Registered', accountCodes: getAccountCodes('GOODS') },
  { code: '120108', name: 'SPEED ENTERPRISES', nature: 'GOODS', address: '314-315 3RD FLOOR THE FORUM, G-20, MAIN KHAYABAN-E-JAMI, CLIFTON', ntn: '3037492-8', strn: '1700910000273', accountCodes: getAccountCodes('GOODS') },
  { code: '120109', name: 'NAYAB PEST CONTROL SERVICES', nature: 'SERVICES', address: '44 LGF CENTRAL PLAZA BARKET MARKET NEW GARDEN TOWN, LAHORE', contactNo: '0300-6945607', ntn: '2061541-8', strn: '0302380801773', pra: 'P2061541-8', accountCodes: getAccountCodes('SERVICES') },
  { code: '120110', name: 'FLOW MASTER', nature: 'GOODS / SERVICES', address: 'Office # 203, 2nd Floor, Shahwar Trade Centre, Plot 72/S, P.E.C.H.S., Allama Iqbal Road, Karachi', contactNo: '0345-3115524', cnic: '42201-6919762-7', ntn: '7560750-3', srb: 'S7560750-3', accountCodes: getAccountCodes('GOODS / SERVICES') },
  { code: '120111', name: 'MUNSEEB (PVT.) LTD.', nature: 'GOODS', address: 'House No. 52-B/1, Khayaban-e-Shahbaz Phase VII, DHA Karachi', contactNo: '0301-8221896', ntn: '5230525-4', strn: '3277876157986', accountCodes: getAccountCodes('GOODS') },
  { code: '120112', name: '7SIGN', nature: 'GOODS', address: 'HOUSE NO. B-60, AL HOUSING SOCIETY, HALT KARACHI TOWN, MALIR', cnic: '42501-7759095-3', ntn: '4026346-7', strn: '1700402634611', srb: 'S4026346-7', accountCodes: getAccountCodes('GOODS') },
  { code: '120113', name: 'CONCEPTIONAL MARKETING SOLUTIONS', nature: 'GOODS', address: 'House no.1119, St-11B, Makkah Colony, Lahore, Gulberg Town', contactNo: '0321-4239756', cnic: '35201-4161560-3', ntn: 'A227051-8', accountCodes: getAccountCodes('GOODS') },
  { code: '120114', name: 'LUCKY MOTOR CORPORATION LTD.', nature: 'GOODS / SERVICES', address: 'Arabian Sea Country Club Road, Bin Qasim Industrial Park (SEZ), Pakistan Steel Mills', ntn: '7357373-8', strn: 'Registered', srb: 'S7357373-8', pra: 'P7357373-8', accountCodes: getAccountCodes('GOODS / SERVICES') },
  { code: '120115', name: 'HONDA ATLAS CARS (PAKISTAN) LTD.', nature: 'GOODS / SERVICES', address: '43 K.M. MULTAN ROAD MANGA MANDI, LAHORE', ntn: '0829237-0', strn: 'Registered', srb: 'S0829237-0', pra: 'P0829237-0', accountCodes: getAccountCodes('GOODS / SERVICES') },
  { code: '120116', name: 'MATEEN SONS', nature: 'GOODS', address: 'C-109 Sector, 32 A Korangi, Karachi', cnic: '42000-0570091-1', ntn: '0293679-8', strn: 'Registered', accountCodes: getAccountCodes('GOODS') },
  { code: '120117', name: 'REANDA HAROON ZAKARIA ASSOCIATES', nature: 'SERVICES', address: 'Office No. M1 - M4, Progressive Plaza, Beaumont Road, Civil Lines, Karachi', contactNo: '021-35674741', ntn: '8965119-3', srb: 'S8965119-3', accountCodes: getAccountCodes('SERVICES') },
  { code: '120118', name: 'KIA MOTOR SITE', nature: 'GOODS / SERVICES', address: 'X-2, Manghopir Road, S.I.T.E, Karachi West Site Town', contactNo: '021-32570082', cnic: '42201-5701403-1', ntn: '3998159-2', strn: 'Registered', srb: 'S3998159-2', accountCodes: getAccountCodes('GOODS / SERVICES') },
  { code: '120119', name: 'HONDA SOUTH (PVT.) LTD.', nature: 'GOODS / SERVICES', address: '1-B/1 SECTOR#23, KORANGI INDUSTRIAL AREA, KIA, KARACHI', contactNo: '021-35050251', ntn: '0984519-4', strn: '1712870820191', srb: 'S0984519-4', accountCodes: getAccountCodes('GOODS / SERVICES') },
  { code: '120120', name: 'DHA DOLMEN LAHORE (PVT.) LTD.', nature: 'RENT', address: 'Plot# 158, Sector A, DHA, Phase VI, Lahore Cantonement', contactNo: '021-32603449', ntn: '5298402-3', strn: 'Registered', pra: 'P5298402-3', accountCodes: getAccountCodes('RENT') },
  { code: '120121', name: 'Universal Network Systems (Pvt.) Ltd.', nature: 'SERVICES', address: 'Suit# 606 TRADE TOWER ABDULLAH HAROON ROAD, KARACHI', ntn: '2691562-6', strn: 'Registered', srb: 'S2691562-6', pra: 'P2691562-6', accountCodes: getAccountCodes('SERVICES') },
  { code: '120122', name: 'PESSI', nature: 'SERVICES', address: '3-A, Gulberg-V, Jail Road, Lahore', contactNo: '042-99263107', accountCodes: getAccountCodes('SERVICES') },
  { code: '120123', name: 'SESSI', nature: 'SERVICES', address: 'Block 6 Gulshan-e-Iqbal, Karachi', contactNo: '021-99243813', accountCodes: getAccountCodes('SERVICES') },
  { code: '120124', name: 'PAK LOGISTICS SOLUTIONS', nature: 'SERVICES', address: '49 / A, BLOCK - 2, P.E.C.H.S., KARACHI', contactNo: '0300-2222412', ntn: '4578604-3', strn: 'Registered', srb: 'S4578604-3', pra: 'P4578604-3', accountCodes: getAccountCodes('SERVICES') },
  { code: '120125', name: 'ASAF ALI HUSSAIN', nature: 'RENT', address: 'HOUSE NO D-22 BLOCK 7 CLIFTON', cnic: '42301-9918072-3', ntn: '2254196-9', strn: 'Registered', accountCodes: getAccountCodes('RENT') },
  { code: '120126', name: 'SARFRAZ AHMED', nature: 'RENT', address: 'House# 17 Block-C, Gulberg Colony, Faisalabad', contactNo: '0344-6600661', cnic: '33102-1818518-7', ntn: '0058555-6', strn: 'Registered', accountCodes: getAccountCodes('RENT') },
  { code: '120127', name: 'LEOPARDS COURIER SERVICES (PVT.) LTD.', nature: 'SERVICES', address: '46-E, E-MARKET, BLOCK-6, P.E.C.H.S., PLAZA SQUARE, KARACHI', contactNo: '021-34532392', ntn: '2824502-4', strn: '1200980800191', srb: 'S2824502-4', pra: 'P2824502-4', accountCodes: getAccountCodes('SERVICES') },
  { code: '120128', name: 'APCO PARK ONE (PRIVATE) LIMITED', nature: 'RENT', address: 'Head Office # 54, Margalla Road, F-8/2, Islamabad', contactNo: '051-2266104', accountCodes: getAccountCodes('RENT') },
  { code: '120129', name: 'ABDUL HANNAN', nature: 'RENT', address: 'Plot# 3-103, C P Berar 1st Floor, Left Side, Karachi East Gulshan Town', cnic: '42301-6853276-7', ntn: '7154631-0', accountCodes: getAccountCodes('RENT') },
  { code: '120130', name: 'MUHAMMAD ANIS', nature: 'RENT', address: 'House# 103, Street# 9, Block 3, C.P Berrar Society Sharfabad, Karachi East', cnic: '42301-0954438-9', ntn: 'D673376-5', accountCodes: getAccountCodes('RENT') },
  { code: '120131', name: 'MRS MEHFOOZA BANO', nature: 'RENT', address: 'Wali Garden 2nd Floor Plot# 141, Fuwara Chowk Flat# 203, Karachi', cnic: '42401-7164919-2', ntn: '2304569-8', accountCodes: getAccountCodes('RENT') },
  { code: '120132', name: 'GRANT THORNTON ANJUM RAHMAN', nature: 'SERVICES', address: '1st & 3rd Floor, Modern Motors House, Beaumont Road, Karachi South Saddar Town', contactNo: '021-35672951', ntn: '1473393-5', strn: 'Registered', srb: 'S1473393-5', pra: 'P1473393-5', accountCodes: getAccountCodes('SERVICES') },
  { code: '120133', name: 'HOTEL HILLVIEW (PVT.) LTD.', nature: 'SERVICES', address: 'BLOCK NO12-A, MARKEZ F-7, ISLAMABAD', contactNo: '0321-5157470', ntn: '2812327-1', strn: 'Registered', accountCodes: getAccountCodes('SERVICES') },
  { code: '120134', name: 'SAFE & SECURE SYSTEMS', nature: 'GOODS', address: 'A-214, Block-13, Gulistan-e-Johar, Karachi East Gulshan Town', contactNo: '0332-8289201', cnic: '42101-1404192-9', ntn: '7298156-2', strn: 'Registered', srb: 'S7298156-2', accountCodes: getAccountCodes('GOODS') },
  { code: '120135', name: 'POSTECH ENTERPRISES', nature: 'GOODS', address: 'D-227/B, SITE, KARACHI WEST, Karachi West Site Town', contactNo: '0317-8220585', ntn: 'A118571-5', strn: 'Registered', srb: 'SA118571-5', accountCodes: getAccountCodes('GOODS') },
  { code: '120136', name: 'PAKO COMPUTERS', nature: 'GOODS', address: '10, GROUND FLOOR, BUSINESS ARCADE, BLOCK-6, P.E.C.H.S., SHAHRAH-E-FAISAL, KARACHI', contactNo: '0321-2351484', ntn: '1432726-7', strn: '1700850009919', srb: 'S1432726-7', pra: 'P1432726-7', accountCodes: getAccountCodes('GOODS') },
  { code: '120137', name: 'THE FRESH DROPS', nature: 'GOODS', address: 'A-157, Block 13-A, Railway Society Gulshan-E-Iqbal, Karachi', contactNo: '0334-9575615', cnic: '42201-7174976-1', ntn: '7938387-0', accountCodes: getAccountCodes('GOODS') },
  { code: '120138', name: 'H.N TECH SERVICES', nature: 'GOODS', address: 'Plot# l-59, St-12 Sector 31/b, KDA Employees Housing Society, Karachi', contactNo: '0300-3641332', cnic: '31303-4432570-7', ntn: '9285831-0', accountCodes: getAccountCodes('GOODS') },
  { code: '120139', name: 'SUPER LINE PEST CONTROL', nature: 'SERVICES', address: 'House# 1, Mohalla Ahmad Street, Bahar Colony Kot Lakhpat, Lahore', contactNo: '0308-4885611', cnic: '35201-4484094-6', ntn: 'E439736-5', accountCodes: getAccountCodes('SERVICES') },
  { code: '120140', name: 'NEOCOM', nature: 'GOODS', address: 'FLAT NO.104, PLOT NO.164/3, BAHADURABAD CENTER, BMCHS, BLOCK-3, Karachi East Gulshan Town', contactNo: '0333-3095987', cnic: '42201-7180115-9', ntn: '1358557-6', strn: 'Registered', srb: 'S1358557-6', pra: 'P1358557-6', accountCodes: getAccountCodes('GOODS') },
  { code: '120141', name: 'KARACHI CHAMBER OF COMMERCE AND INDUSTRY', nature: 'SERVICES', address: 'Aiwan-e-Tijarat Road, off: Shahrah-e-liaquat, P.O. Box# 4158, Karachi', contactNo: '021-99218001', accountCodes: getAccountCodes('SERVICES') },
  { code: '120142', name: 'THE AMERICAN BUSINESS COUNCIL OF PAKISTAN', nature: 'SERVICES', address: '55-C, 3rd Floor, Al-Murtaza Commercial, Lane-2, Phase 8-A, DHA, Karachi', contactNo: '021-35248915', accountCodes: getAccountCodes('SERVICES') },
  { code: '120143', name: 'SPRINT SERVICES RAWALPINDI LIMITED', nature: 'RENT', address: '14 Floor, BRR Tower, I I Chundrigar Road, Karachi South, Saddar Town', contactNo: '0300-6976631', ntn: '3053809-2', strn: 'Registered', pra: 'P3053809-2', accountCodes: getAccountCodes('RENT') },
  { code: '120144', name: 'HIMS ENTERPRISES', nature: 'RENT', address: 'Plot No. 3, Sector 40, DEH Mehran-1, Tappo Mehran, Taluka Air Port, District Malir, Karachi', contactNo: '0333-8688007', ntn: '7335779-5', accountCodes: getAccountCodes('RENT') },
  { code: '120145', name: 'WAQAS LIAQAT', nature: 'RENT', address: 'House No. 1499/2-A Main Street Khawaja Colony Faizi Road', cnic: '36302-4630060-1', ntn: '0954992-7', accountCodes: getAccountCodes('RENT') },
  { code: '120146', name: 'FAIZAN MUSHTAQ', nature: 'RENT', address: 'House No. 1498/9/1 Street No. 1 Khawaja Colony Faizi Road', cnic: '36302-8126368-9', ntn: '3377242-8', accountCodes: getAccountCodes('RENT') },
  { code: '120147', name: 'INNOVATIVE NETWORK (PVT.) LTD.', nature: 'SERVICES', address: 'Bungalow No. 41, J/III, Mehmood Hassan Road, Block 6 PECHS Near Lal Kothi, Karachi', contactNo: '0316-2467066', ntn: '7224220-1', srb: 'S7224220-1', accountCodes: getAccountCodes('SERVICES') },
  { code: '120148', name: 'STRATEGIC ENTERPRISES', nature: 'SERVICES', address: '138, K.J Arcade, 16th Street, Phase I, DHA, Karachi', contactNo: '021-34490035', ntn: 'G212735-2', srb: 'SG212735-2', accountCodes: getAccountCodes('SERVICES') },
  { code: '120149', name: 'ALLIED RECORD MANAGEMENT CO (PVT) LTD.', nature: 'SERVICES', address: 'Portion A-8, Plot NC-362, Deh Joriji, Bin Qasim Town, Malir Bin Qasim Town', contactNo: '0349-0236369', ntn: '4377230-7', strn: 'Registered', srb: 'S4377230-7', accountCodes: getAccountCodes('SERVICES') },
  { code: '120150', name: 'OTHERS P/A', nature: 'SERVICES', address: 'Office No. 1st Floor, Services Club, Ext. Building Mereweather Road, Karachi', contactNo: '021-35652161', accountCodes: getAccountCodes('SERVICES') },
];

// Import Vendors (IMP001-IMP019)
type ImportBrandCategory = 'SPORTS' | 'FASHION' | 'WATCHES';

function getImportAccountCodes(category: ImportBrandCategory): string[] {
  switch (category) {
    case 'SPORTS':  return ['12010001']; // BILLS PAYABLE-IMPORTS SPORTS BRANDS
    case 'FASHION': return ['12010002']; // BILLS PAYABLE-IMPORTS FASHION BRANDS
    case 'WATCHES': return ['12010003']; // BILLS PAYABLE-IMPORTS WATCH BRNDS
  }
}

const vendorsImport: VendorSeed[] = [
  // Sports Brands → 12010001
  { code: 'IMP001', brand: 'NIKE',         name: 'NIKE GLOBAL TRADING BV SINGAPORE BRANCH', nature: 'GOODS', address: '30 Pasir Panjang Road No. 10-31/32, Mapletree Business City, Singapore 117440', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP002', brand: 'NIKE',         name: 'OD360 PTE LTD',                            nature: 'GOODS', address: '119 Genting Lane, #03-00, HB@ 119 Genting, Singapore, 349570', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP003', brand: 'ADIDAS',       name: 'ADIDAS EMERGING MARKETS FZE',              nature: 'GOODS', address: 'Dubai Design District (d3), Building No.2 4th Floor 32512 Dubai, UAE', contactNo: '971-4-5123500', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP004', brand: 'ASICS',        name: 'ASICS ARABIA FZE',                         nature: 'GOODS', address: 'ASICS Middle East Trading L.L.C. Unit 307B, Building No. 5, P.O. Box 49774 Dubai Design District, Dubai, UAE', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP005', brand: 'BIRKENSTOCK',  name: 'BIRKENSTOCK GLOBAL SALES GMBH',            nature: 'GOODS', address: 'Birkenstock Logistics GmbH Burg Ockenfels 53545 Linz am Rhein Germany', contactNo: '+49 2683 9359 0', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP006', brand: 'PUMA',         name: 'PUMA SOUTH EAST ASIA PTE LTD',             nature: 'GOODS', address: 'PUMA MIDDLE EAST FZ-LLC P.O. BOX 500626 DUBAI, UAE', contactNo: '971-4-5621222', accountCodes: getImportAccountCodes('SPORTS') },
  { code: 'IMP007', brand: 'UNDER ARMOUR', name: 'UA SPORTS (S.E.A.) PTE. LTD.',             nature: 'GOODS', address: '7 Temasek Boulevard, #25-01, Suntec Tower One Singapore 038987 SGP', contactNo: '+65 6225 2881', accountCodes: getImportAccountCodes('SPORTS') },
  // Fashion Brands → 12010002
  { code: 'IMP008', brand: 'CHARLES & KEITH', name: 'CHARLES & KEITH INTERNATIONAL PTE LTD', nature: 'GOODS', address: '6 Tai Seng Link, Level 8 Charles & Keith Group Headquarters Singapore 534101', contactNo: '+65 6488 2688', accountCodes: getImportAccountCodes('FASHION') },
  { code: 'IMP009', brand: 'PEDRO',            name: 'CHARLES & KEITH INTERNATIONAL PTE LTD', nature: 'GOODS', address: '6 Tai Seng Link, Level 8 Charles & Keith Group Headquarters Singapore 534101', contactNo: '+65 6488 2688', accountCodes: getImportAccountCodes('FASHION') },
  // Watch Brands → 12010003
  { code: 'IMP010', brand: 'TAG HEUER',    name: 'TAG HEUER',              nature: 'GOODS', address: 'Tag Heuer Branch of LVMH Swiss Manufactures SA Av. Luis-Joseph Chevrolet 4-6A CH-2300 La Chaux-de-Fond', accountCodes: getImportAccountCodes('WATCHES') },
  { code: 'IMP011', brand: 'TIMEX',        name: 'TIMEX NEDERLAND B.V.',   nature: 'GOODS', address: 'TIMEX NEDERLAND B.V. TAURUSAVENUE 17A, 2132 LS HOOFDDORP, THE NETHERLANDS.', contactNo: '+31 23 556 3664', accountCodes: getImportAccountCodes('WATCHES') },
  { code: 'IMP012', brand: 'TIMBERLAND',   name: 'ILG EMEA DWC LLC',       nature: 'GOODS', address: 'Plot No: WB27-WB28, Logistics District Dubai World Central, DUBAI, UNITED ARAB EMIRATES', contactNo: '+971 4 803 2222', accountCodes: getImportAccountCodes('WATCHES') },
  { code: 'IMP013', brand: 'POLICE',       name: 'ILG EMEA DWC LLC',       nature: 'GOODS', address: 'Plot No: WB27-WB28, Logistics District Dubai World Central, DUBAI, UNITED ARAB EMIRATES', contactNo: '+971 4 803 2222', accountCodes: getImportAccountCodes('WATCHES') },
  // Fashion Brands → 12010002
  { code: 'IMP014', brand: 'USPA',         name: 'SAAT VE SAAT SAN.VETİC.A.Ş.', nature: 'GOODS', address: 'Büyükdere Cad. Noramin İş Merkezi No:237/D Kat:B2 Maslak, İstanbul/Türkiye', contactNo: '+90 (212) 232 7 228', accountCodes: getImportAccountCodes('FASHION') },
  { code: 'IMP015', brand: 'DANISH DESIGN', name: 'WEISZ GROUP',               nature: 'GOODS', address: 'Weisz Group Heijermanslaan 47A 1422 GV Uithoorn The Netherlands', contactNo: '+31 (0)20 679 46 33', accountCodes: getImportAccountCodes('FASHION') },
  { code: 'IMP016', brand: 'NAUTICA',      name: 'TIMEX NEDERLAND B.V.',   nature: 'GOODS', address: 'TIMEX NEDERLAND B.V. TAURUSAVENUE 17A, 2132 LS HOOFDDORP, THE NETHERLANDS.', accountCodes: getImportAccountCodes('WATCHES') },
  // Watch Brands → 12010003
  { code: 'IMP017', brand: 'TISSOT',       name: 'THE LEGEND',             nature: 'GOODS', address: '1-C Street 7A, Badar Commercial Area, DHA Ph V ext., Karachi.', contactNo: '021 35205108', accountCodes: getImportAccountCodes('WATCHES') },
  { code: 'IMP018', brand: 'RADO',         name: 'THE LEGEND',             nature: 'GOODS', address: '1-C Street 7A, Badar Commercial Area, DHA Ph V ext., Karachi.', accountCodes: getImportAccountCodes('WATCHES') },
  // Fashion Brands → 12010002
  { code: 'IMP019', brand: 'GUESS',        name: 'PARAMOUNT ENTERPRISES PVT LTD.', nature: 'GOODS', address: '1 Dean Arcade Khy-Jami Block 8 Clifton Karachi Pakistan', accountCodes: getImportAccountCodes('FASHION') },
];

const allVendors = [...vendors, ...vendors2, ...vendors3, ...vendorsImport];

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

  // Load all needed account codes in one query
  const uniqueCodes = [...new Set(allVendors.flatMap(v => v.accountCodes))];
  const accounts = await prisma.chartOfAccount.findMany({
    where: { code: { in: uniqueCodes } },
    select: { id: true, code: true },
  });
  const accountMap = new Map(accounts.map(a => [a.code, a.id]));

  // Warn about missing accounts
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

    if (chartOfAccountIds.length === 0) {
      console.warn(`  ⚠️  Skipping ${v.code} ${v.name} — no valid chart of accounts resolved`);
      skipped++;
      continue;
    }

    const existing = await (prisma as any).vendor?.findFirst?.({ where: { code: v.code } })
      ?? await (prisma as any).supplier?.findFirst?.({ where: { code: v.code } });

    const data = {
      code: v.code,
      name: v.name,
      brand: v.brand ?? null,
      type: v.code.startsWith('IMP') ? 'IMPORT' : 'LOCAL',
      nature: v.nature === 'GOODS / SERVICES' ? 'GOODS' : v.nature, // normalize
      address: v.address,
      contactNo: v.contactNo ?? null,
      cnicNo: v.cnic ?? null,
      ntnNo: v.ntn ?? null,
      strnNo: v.strn ?? null,
      srbNo: v.srb ?? null,
      praNo: v.pra ?? null,
      ictNo: v.ict ?? null,
    };

    try {
      const model = (prisma as any).vendor ?? (prisma as any).supplier;
      if (!model) {
        console.error('  ❌ No vendor/supplier model found in Prisma client');
        break;
      }

      if (existing) {
        await model.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await model.create({ data: { ...data, chartOfAccounts: { connect: chartOfAccountIds.map(id => ({ id })) } } });
        created++;
      }
    } catch (err: any) {
      console.warn(`  ⚠️  Failed ${v.code}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`  ✅ Vendors: ${created} created, ${updated} updated, ${skipped} skipped`);
}

async function main() {
  console.log('🚀 Starting Vendor Seeding...');

  const managementUrl = process.env.DATABASE_URL_MANAGEMENT;
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;

  if (!managementUrl || !masterKey) {
    console.error('❌ DATABASE_URL_MANAGEMENT and MASTER_ENCRYPTION_KEY required in .env');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: managementUrl });
  const adapter = new PrismaPg(pool);
  const management = new ManagementClient({ adapter } as any);

  try {
    const tenantArgIdx = process.argv.indexOf('--tenant');
    const specificTenant = tenantArgIdx !== -1 ? process.argv[tenantArgIdx + 1] : null;

    const companies = await management.company.findMany({
      where: { status: 'active', ...(specificTenant ? { dbName: specificTenant } : {}) },
    });

    if (companies.length === 0) {
      console.log('ℹ️ No active companies found.');
      return;
    }

    for (const company of companies) {
      console.log(`\n👉 Processing: ${company.name} (${company.code})`);
      try {
        let connectionString = company.dbUrl;
        if (company.dbPassword) {
          try {
            const decPassword = encodeURIComponent(decrypt(company.dbPassword, masterKey));
            connectionString = `postgresql://${company.dbUser}:${decPassword}@${company.dbHost || 'localhost'}:${company.dbPort || 5432}/${company.dbName}?schema=public`;
          } catch {
            console.warn(`  ⚠️  Decryption failed, using stored dbUrl`);
          }
        }
        if (!connectionString) { console.error(`  ❌ No connection details`); continue; }

        const tenantPool = new Pool({ connectionString });
        const tenantAdapter = new PrismaPg(tenantPool);
        const tenantPrisma = new PrismaClient({ adapter: tenantAdapter });

        try {
          await tenantPrisma.$connect();
          await seedVendors(tenantPrisma);
        } finally {
          await tenantPrisma.$disconnect();
          await tenantPool.end();
        }
      } catch (err: any) {
        console.error(`  ❌ Failed: ${err.message}`);
      }
    }

    console.log('\n✨ Done.');
  } finally {
    await management.$disconnect();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
