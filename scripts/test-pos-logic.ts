import { generateNextPosId } from '../src/common/utils/pos-id-generator';

function testGenerator() {
    console.log('🧪 Testing PosIdGenerator...');

    // Test Case 1: Empty list
    console.log('Test 1 (Empty):', generateNextPosId([]) === '001' ? '✅' : '❌');

    // Test Case 2: Numeric sequence
    console.log('Test 2 (001, 002):', generateNextPosId(['001', '002']) === '003' ? '✅' : '❌');

    // Test Case 3: Transition to alpha
    console.log('Test 3 (009):', generateNextPosId(['001', '002', '003', '004', '005', '006', '007', '008', '009']) === '00a' ? '✅' : '❌');

    // Test Case 4: Filling gaps
    console.log('Test 4 (Gap):', generateNextPosId(['001', '003']) === '002' ? '✅' : '❌');

    // Test Case 5: Filling gap before 00z
    console.log('Test 5 (00z):', generateNextPosId(['00z']) === '001' ? '✅' : '❌');

    // Test Case 6: Random alphanumeric
    console.log('Test 6 (abc):', generateNextPosId(['abc']) === '001' ? '✅' : '❌');
    // Wait, if abc is there, it should find it and move on? 
    // Actually my logic finds the next available starting from 001.
    // If only 'abc' is there, nextVal=1 (001) is available. 

    console.log('Test 7 (001-00z):', generateNextPosId(['001', '002', '003', '004', '005', '006', '007', '008', '009', '00a', '00b', '00c', '00d', '00e', '00f', '00g', '00h', '00i', '00j', '00k', '00l', '00m', '00n', '00o', '00p', '00q', '00r', '00s', '00t', '00u', '00v', '00w', '00x', '00y', '00z']) === '010' ? '✅' : '❌');

    console.log('🎉 Verification complete!');
}

testGenerator();
