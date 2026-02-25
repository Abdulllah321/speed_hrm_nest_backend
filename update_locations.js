const fs = require('fs');

const file = 'd:/projects/speed-limit/nestjs_backend/backup/companies/tenant_speed_sport_mkzblxzg.sql';
let data = fs.readFileSync(file, 'utf8');

const cities = {
    'Karachi': '0505c97a-3016-4fd2-b951-b9523e863899',
    'Lahore': '3681a23d-4115-486c-a99b-cd4891b297d7',
    'Islamabad': 'b6295e2e-cc9a-465b-8846-8000eb4953b3',
    'Multan': '86e3d083-ca49-4658-8ead-c733faa71212',
    'Faisalabad': '0b0e0a33-7db3-459c-bf88-462c0740e489',
    'Rawalpindi': '4dd7bbb8-b42b-4460-a537-efa24a285dba',
    'Sialkot': '272cba3f-9fa8-4f42-bc3a-c6f145986cf9'
};

const locations = [
    { match: 'Services Club Extension Building', lat: 24.8517077, lng: 67.0302625, city: 'Karachi' },
    { match: 'Services Club Ext', lat: 24.8517077, lng: 67.0302625, city: 'Karachi' },
    { match: 'korangi Industrial area', lat: 24.8329623, lng: 67.1121087, city: 'Karachi' },
    { match: 'Dolmen Mall, Clifton', lat: 24.8037346, lng: 67.0309191, city: 'Karachi' },
    { match: 'Dolmen Mall Clifton', lat: 24.8037346, lng: 67.0309191, city: 'Karachi' },
    { match: 'Xinhua Mall', lat: 31.5126868, lng: 74.3486338, city: 'Lahore' },
    { match: 'Packages Mall', lat: 31.4554471, lng: 74.3644075, city: 'Lahore' },
    { match: 'Centaurus Mall', lat: 33.7077464, lng: 73.0503043, city: 'Islamabad' },
    { match: 'Safa Gold Mall', lat: 33.7224213, lng: 73.0560371, city: 'Islamabad' },
    { match: 'Safa Mall', lat: 33.7224213, lng: 73.0560371, city: 'Islamabad' },
    { match: 'The Forum Mall', lat: 24.8269785, lng: 67.0375806, city: 'Karachi' },
    { match: 'Lucky One Mall', lat: 24.9458925, lng: 67.0863866, city: 'Karachi' },
    { match: 'Lucke One Mall', lat: 24.9458925, lng: 67.0863866, city: 'Karachi' },
    { match: 'ZamZam Arcade', lat: 24.8197775, lng: 67.0336712, city: 'Karachi' },
    { match: 'Fountain Avenue', lat: 31.5165909, lng: 74.3483984, city: 'Lahore' },
    { match: 'Emporium Mall', lat: 31.4674712, lng: 74.2652232, city: 'Lahore' },
    { match: 'Dolmen Mall Lahore', lat: 31.4789508, lng: 74.455959, city: 'Lahore' },
    { match: 'Giga Mall', lat: 33.5303649, lng: 73.1491771, city: 'Islamabad' },
    { match: 'GIGA Mall', lat: 33.5303649, lng: 73.1491771, city: 'Islamabad' },
    { match: 'Mall of Multan', lat: 30.2281297, lng: 71.4678854, city: 'Multan' },
    { match: 'Lyallpur Galleria', lat: 31.4246949, lng: 73.1099195, city: 'Faisalabad' },
    { match: 'Jinnah Icon Mall', lat: 24.9198642, lng: 67.1989467, city: 'Karachi' },
    { match: 'Kashmir Road, Saddar', lat: 33.5936718, lng: 73.054366, city: 'Rawalpindi' },
    { match: 'United Mall Gulghast', lat: 30.2173516, lng: 71.4727144, city: 'Multan' },
    { match: 'Dolmen Mall, Tariq Road', lat: 24.8726555, lng: 67.059436, city: 'Karachi' },
    { match: 'The Boulevard Mall', lat: 31.5284144, lng: 74.3496464, city: 'Lahore' },
    { match: 'Bank Road, Saddar', lat: 33.5956795, lng: 73.0526019, city: 'Rawalpindi' },
    { match: 'Khawaja Safdar Road, Sialkot', lat: 32.5029392, lng: 74.5248644, city: 'Sialkot' }
];

let lines = data.split('\n');
let replacedCount = 0;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('INSERT INTO public."Location"')) {
        for (let loc of locations) {
            if (lines[i].includes(loc.match)) {
                let originalLine = lines[i];
                lines[i] = lines[i].replace(
                    /', (NULL|[\d\.\-]+), (NULL|[\d\.\-]+), '([a-f0-9\-]{36})'/,
                    (match, p1, p2, prevCityId) => {
                        return "', " + loc.lat + ", " + loc.lng + ", '" + cities[loc.city] + "'";
                    }
                );
                if (originalLine !== lines[i]) {
                    replacedCount++;
                }
                break;
            }
        }
    }
}

fs.writeFileSync(file, lines.join('\n'));
console.log("Updated locations count: " + replacedCount);
