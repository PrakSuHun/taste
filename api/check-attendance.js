import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// 💡 노션이 바쁠 때 잠깐 쉬게 만드는 함수
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: '잘못된 요청 방식입니다.' });
  }

  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: '이름을 입력해 주세요.' });
  }

  // 재시도(Retry) 설정: 최대 3번까지 다시 시도합니다.
  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      // 1. 노션 데이터베이스 검색
      const response = await notion.databases.query({
        database_id: DATABASE_ID,
        filter: {
          property: '이름',
          title: { equals: name.trim() },
        },
      });

      if (response.results.length === 0) {
        return res.status(200).json({ success: false, message: '명단에 존재하지 않습니다.' });
      }

      const page = response.results[0];
      const pageId = page.id;
      
      // 2. 팀 번호 추출
      let teamNumber = "미배정";
      const teamProp = page.properties['팀번호'];
      if (teamProp?.type === 'rich_text' && teamProp.rich_text.length > 0) {
          teamNumber = teamProp.rich_text[0].plain_text.replace('팀', '').trim(); 
      } 

      // 3. 음료 정보 추출
      let beverageInfo = "미선택";
      const beverageProp = page.properties['음료'];
      if (beverageProp?.type === 'rich_text' && beverageProp.rich_text.length > 0) {
          beverageInfo = beverageProp.rich_text[0].plain_text;
      } 

      // 4. 출석 체크박스 업데이트
      await notion.pages.update({
        page_id: pageId,
        properties: {
          '출석': { checkbox: true },
        },
      });

      // 5. 성공 응답 전송 (성공했으므로 while 루프 종료)
      return res.status(200).json({ 
          success: true, 
          team: teamNumber,
          beverage: beverageInfo
      });

    } catch (error) {
      attempt++;
      console.error(`Notion API 에러 (시도 ${attempt}/${MAX_RETRIES}):`, error.message);
      
      // 429 에러(Too Many Requests) 이거나 일시적인 네트워크 오류일 경우 재시도
      if (error.status === 429 || error.status >= 500) {
        if (attempt >= MAX_RETRIES) {
          return res.status(500).json({ success: false, message: '동시 접속자가 많아 지연되고 있습니다. 잠시 후 다시 시도해주세요.' });
        }
        // 시도 횟수가 늘어날수록 기다리는 시간을 늘림 (1초 -> 2초 -> 3초)
        await delay(attempt * 1000); 
      } else {
        // 그 외의 치명적 에러는 바로 종료
        return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
      }
    }
  }
}


