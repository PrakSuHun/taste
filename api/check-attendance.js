import { Client } from '@notionhq/client';

// Vercel 환경 변수에서 API 키와 데이터베이스 ID 가져오기
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

export default async function handler(req, res) {
  // POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: '잘못된 요청 방식입니다.' });
  }

  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ success: false, message: '이름을 입력해 주세요.' });
  }

  try {
    // 1. 노션 데이터베이스에서 이름 검색 (캡처본의 'Aa 이름' 컬럼)
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: '이름',
        title: {
          equals: name.trim(), // 앞뒤 공백 제거 후 검색
        },
      },
    });

    // 검색 결과가 없으면 실패 처리
    if (response.results.length === 0) {
      return res.status(200).json({ success: false, message: '명단에 존재하지 않습니다.' });
    }

    // 제일 첫 번째 검색된 데이터 가져오기
    const page = response.results[0];
    const pageId = page.id;
    
    // 2. 팀 번호 가져오기 (캡처본의 '≡ 팀번호' 컬럼)
    let teamNumber = "미배정";
    try {
        const teamProp = page.properties['팀번호'];
        if (teamProp && teamProp.type === 'rich_text' && teamProp.rich_text.length > 0) {
            teamNumber = teamProp.rich_text[0].plain_text;
            // 노션에 "14팀"으로 적혀있을 경우, 프론트엔드의 "팀" 글자와 중복되지 않도록 제거
            teamNumber = teamNumber.replace('팀', '').trim(); 
        } 
    } catch (e) {
        console.log("팀 번호를 읽어오지 못했습니다.");
    }

    // 3. 음료 정보 가져오기 (캡처본의 '≡ 음료' 컬럼)
    let beverageInfo = "미선택";
    try {
        const beverageProp = page.properties['음료'];
        if (beverageProp && beverageProp.type === 'rich_text' && beverageProp.rich_text.length > 0) {
            beverageInfo = beverageProp.rich_text[0].plain_text;
        } 
    } catch (e) {
        console.log("음료 정보를 읽어오지 못했습니다.");
    }

    // 4. 출석 체크박스 업데이트 (캡처본의 '☑️ 출석' 컬럼)
    await notion.pages.update({
      page_id: pageId,
      properties: {
        '출석': {
          checkbox: true, // 체크박스를 V 체크 상태로 변경
        },
      },
    });

    // 5. 프론트엔드로 성공 결과 및 데이터(팀, 음료) 전송
    return res.status(200).json({ 
        success: true, 
        team: teamNumber,
        beverage: beverageInfo
    });

  } catch (error) {
    console.error('Notion API 에러:', error);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
}
